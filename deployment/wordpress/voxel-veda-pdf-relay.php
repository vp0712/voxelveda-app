<?php
/**
 * Plugin Name: Voxel Veda validated PDF relay
 * Description: Company mail bridge with PDF parser validation, named binary MIME parts and safe retries.
 * Version: 3.0.0
 */
if (!defined('ABSPATH')) { exit; }
$autoload = __DIR__ . '/vendor/autoload.php';
if (file_exists($autoload)) { require_once $autoload; }
function vv_pdf_relay_permission($request) {
    $expected = defined('VOXEL_VEDA_MAIL_RELAY_TOKEN') ? VOXEL_VEDA_MAIL_RELAY_TOKEN : getenv('VOXEL_VEDA_MAIL_RELAY_TOKEN');
    return is_string($expected) && strlen($expected) >= 32 && hash_equals($expected, (string)$request->get_header('X-Voxel-Veda-Relay-Token'));
}
function vv_pdf_relay_health() {
    $parser = class_exists('\Smalot\PdfParser\Parser');
    // API mail plugins may short-circuit wp_mail before phpmailer_init. Their
    // attachment contract must be reviewed explicitly before document sends.
    $native_mime = !function_exists('has_filter') || has_filter('pre_wp_mail') === false;
    return array('ok' => true, 'attachment_contract_version' => 3, 'attachment_filename_preserved' => $native_mime,
        'pdf_bytes_validated' => $parser, 'native_pdf_mime_supported' => $native_mime,
        'idempotent_requests' => true, 'weekly_recipient_privacy_enforced' => $native_mime, 'provider' => 'wordpress_wp_mail');
}
function vv_pdf_relay_send($request) {
    $data = $request->get_json_params();
    $request_id = (string)($data['request_id'] ?? '');
    if (!preg_match('/^[a-zA-Z0-9:_-]{1,180}$/', $request_id)) return new WP_Error('INVALID_REQUEST_ID', 'A stable request identity is required.', array('status' => 422));
    $key = 'vv_mail_' . hash('sha256', $request_id);
    $previous = get_option($key);
    if (is_array($previous) && ($previous['state'] ?? '') === 'ACCEPTED') return $previous['result'];
    if (!add_option($key, array('state' => 'PROCESSING', 'created_at' => gmdate('c')), '', false)) {
        return new WP_Error('DELIVERY_REVIEW_REQUIRED', 'This request is in progress or its outcome requires administrator review. It was not sent again.', array('status' => 409));
    }
    $attempted = false;
    try {
        $parts = array(); $size = 0;
        foreach (($data['attachments'] ?? array()) as $attachment) {
            if (!class_exists('\Smalot\PdfParser\Parser')) throw new Exception('PDF parser must be installed before document email is enabled.');
            $name = (string)($attachment['filename'] ?? '');
            if (!preg_match('/^[\x20-\x7E]{1,164}\.pdf$/', $name) || preg_match('/[\\\\\/"\r\n]/', $name)) throw new Exception('A safe original .pdf filename is required.');
            if (($attachment['contentType'] ?? '') !== 'application/pdf') throw new Exception('Only application/pdf attachments are permitted.');
            $bytes = base64_decode((string)($attachment['content_base64'] ?? ''), true);
            if ($bytes === false || substr($bytes, 0, 5) !== '%PDF-' || strlen($bytes) < 100) throw new Exception('Invalid PDF bytes.');
            $size += strlen($bytes);
            if ($size > 20 * 1024 * 1024) throw new Exception('PDF attachment limit exceeded.');
            if (strlen($bytes) !== (int)($attachment['byte_length'] ?? 0) || !hash_equals((string)($attachment['sha256'] ?? ''), hash('sha256', $bytes))) throw new Exception('PDF integrity mismatch.');
            $parsed = (new \Smalot\PdfParser\Parser())->parseContent($bytes);
            if (count($parsed->getPages()) < 1) throw new Exception('The PDF has no valid pages.');
            $parts[] = array('name' => $name, 'bytes' => $bytes, 'pages' => count($parsed->getPages()));
        }
        $recipients = array();
        foreach (($data['to'] ?? array()) as $address) {
            if (!is_email($address)) throw new Exception('Invalid recipient.');
            $recipients[] = $address;
        }
        if (!$recipients) throw new Exception('A recipient is required.');
        $weekly = null;
        if (strpos($request_id, 'weekly-timesheet:') === 0 || isset($data['delivery_policy'])) {
            $weekly = $data['delivery_policy'] ?? null;
            if (!is_array($weekly) || ($weekly['type'] ?? '') !== 'WEEKLY_TIMESHEET' ||
                (int)($weekly['staffId'] ?? 0) < 1 || (int)($weekly['deliveryId'] ?? 0) < 1 || (int)($weekly['revision'] ?? 0) < 1 ||
                !preg_match('/^[a-f0-9]{64}$/', (string)($weekly['sourceHash'] ?? '')) ||
                !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($weekly['fromDate'] ?? '')) || !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)($weekly['toDate'] ?? '')) ||
                $request_id !== 'weekly-timesheet:'.$weekly['staffId'].':'.$weekly['fromDate'].':'.$weekly['toDate'].':v'.$weekly['revision'] ||
                count($recipients) !== 1 || $recipients[0] !== ($weekly['recipient'] ?? '') || !empty($data['cc']) || !empty($data['bcc']) || count($parts) !== 1) throw new Exception('Weekly timesheets require one exact designated recipient, no copies, one validated PDF and a stable staff/period/version policy.');
        }
        $headers = array('Content-Type: text/html; charset=UTF-8', 'From: Voxel Veda <info@voxelveda.com>');
        foreach (array('cc' => 'Cc', 'bcc' => 'Bcc') as $field => $header) {
            foreach (($data[$field] ?? array()) as $address) {
                if (!is_email($address)) throw new Exception('Invalid recipient.');
                $headers[] = $header . ': ' . $address;
            }
        }
        if (!empty($data['reply_to'])) {
            if (!is_email($data['reply_to'])) throw new Exception('Invalid reply address.');
            $headers[] = 'Reply-To: ' . $data['reply_to'];
        }
        if ($parts && !vv_pdf_relay_health()['native_pdf_mime_supported']) throw new Exception('The active mail plugin bypasses native PDF MIME construction. Review its attachment transport before enabling document email.');
        // Add the validated bytes directly. PHPMailer never sees a wp_tempnam() basename.
        $observed_mailer = null;
        $attach = function ($mailer) use ($parts, $data, $weekly, &$observed_mailer) {
            // Run after other hooks: fail closed if a provider/plugin expanded
            // the designated address or added a company/manager copy.
            if ($weekly) {
                $to = $mailer->getToAddresses();
                if (count($to) !== 1 || ($to[0][0] ?? '') !== $weekly['recipient'] || count($mailer->getCcAddresses()) || count($mailer->getBccAddresses()) ||
                    count($mailer->getAllRecipientAddresses()) !== 1) throw new Exception('Weekly recipient privacy was changed by a mail hook. No timesheet transport is permitted.');
            }
            $mailer->clearAttachments();
            foreach ($parts as $part) {
                if (!$mailer->addStringAttachment($part['bytes'], $part['name'], 'base64', 'application/pdf', 'attachment')) throw new Exception('PHPMailer could not attach the validated PDF bytes.');
            }
            $mailer->AltBody = (string)($data['text'] ?? '');
            $observed_mailer = $mailer;
        };
        add_action('phpmailer_init', $attach, PHP_INT_MAX);
        $attempted = true;
        try { $accepted = wp_mail($recipients, sanitize_text_field($data['subject'] ?? ''), (string)(($data['html'] ?? '') ?: nl2br(esc_html($data['text'] ?? ''))), $headers); }
        finally { remove_action('phpmailer_init', $attach, PHP_INT_MAX); }
        if (!$accepted) {
            update_option($key, array('state' => 'REVIEW_REQUIRED', 'created_at' => gmdate('c')), false);
            return new WP_Error('DELIVERY_REVIEW_REQUIRED', 'The attempted mail transaction did not report success. Review provider logs before retry; the message was not attempted again.', array('status' => 409));
        }
        if ($parts) {
            if (!$observed_mailer || !method_exists($observed_mailer, 'getAttachments')) throw new Exception('The provider reported acceptance without running the validated PDF MIME hook. Review the transaction before retry.');
            $actual = $observed_mailer->getAttachments();
            if (count($actual) !== count($parts)) throw new Exception('The provider attachment count changed after PDF validation. Review the transaction before retry.');
            foreach ($parts as $index => $part) {
                $mime = $actual[$index];
                if (($mime[0] ?? null) !== $part['bytes'] || ($mime[1] ?? null) !== $part['name'] || ($mime[2] ?? null) !== $part['name'] ||
                    ($mime[3] ?? null) !== 'base64' || ($mime[4] ?? null) !== 'application/pdf' || ($mime[5] ?? null) !== true || ($mime[6] ?? null) !== 'attachment') {
                    throw new Exception('The provider PDF bytes or MIME metadata changed after validation. Review the transaction before retry.');
                }
            }
        }
        if ($weekly) {
            if (!$observed_mailer) throw new Exception('Weekly timesheet transport bypassed the final recipient privacy hook. Review provider logs before retry.');
            $to = $observed_mailer->getToAddresses();
            if (count($to) !== 1 || ($to[0][0] ?? '') !== $weekly['recipient'] || count($observed_mailer->getCcAddresses()) || count($observed_mailer->getBccAddresses()) || count($observed_mailer->getAllRecipientAddresses()) !== 1) throw new Exception('Weekly timesheet recipients changed after the final hook. Review provider logs before retry.');
        }
        $result = array('sent' => true, 'provider_accepted' => true, 'recipient_verified' => false, 'request_id' => $request_id,
            'attachment_contract_version' => 3, 'attachment_filename_preserved' => true, 'pdf_bytes_validated' => true,
            'weekly_recipient_privacy_enforced' => $weekly !== null, 'designated_recipient' => $weekly ? $weekly['recipient'] : null,
            'attachments' => array_map(function ($part) { return array('filename' => $part['name'], 'contentType' => 'application/pdf', 'byte_length' => strlen($part['bytes']), 'sha256' => hash('sha256', $part['bytes']), 'pages' => $part['pages']); }, $parts));
        update_option($key, array('state' => 'ACCEPTED', 'result' => $result), false);
        return $result;
    } catch (Throwable $error) {
        if (!$attempted) delete_option($key);
        else update_option($key, array('state' => 'REVIEW_REQUIRED', 'created_at' => gmdate('c')), false);
        return new WP_Error($attempted ? 'DELIVERY_REVIEW_REQUIRED' : 'PDF_RELAY_VALIDATION_FAILED', $error->getMessage(), array('status' => 422, 'provider_accepted' => isset($accepted) && $accepted === true));
    }
}
add_action('rest_api_init', function () {
    register_rest_route('voxel-veda/v1', '/mail', array('methods' => 'POST', 'callback' => 'vv_pdf_relay_send', 'permission_callback' => 'vv_pdf_relay_permission'));
    register_rest_route('voxel-veda/v1', '/mail/health', array('methods' => 'GET', 'callback' => 'vv_pdf_relay_health', 'permission_callback' => 'vv_pdf_relay_permission'));
    // Retain the current production path. Replace/disable the old conflicting
    // receiver before activation; do not silently change Railway's URL.
    register_rest_route('voxel-veda/v1', '/mail-relay', array('methods' => 'POST', 'callback' => 'vv_pdf_relay_send', 'permission_callback' => 'vv_pdf_relay_permission'));
    register_rest_route('voxel-veda/v1', '/mail-relay/health', array('methods' => 'GET', 'callback' => 'vv_pdf_relay_health', 'permission_callback' => 'vv_pdf_relay_permission'));
});
