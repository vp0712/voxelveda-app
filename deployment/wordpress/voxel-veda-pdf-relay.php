<?php
/**
 * Plugin Name: Voxel Veda validated company mail relay
 * Description: Private HTML timesheets, validated PDF document parts and safe delivery retries.
 * Version: 4.0.0
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
        'idempotent_requests' => true, 'weekly_recipient_privacy_enforced' => $native_mime,
        // HTML report capability is deliberately independent of the PDF parser.
        'weekly_html_contract_version' => 1, 'weekly_html_content_preserved' => $native_mime,
        'provider' => 'wordpress_wp_mail');
}
function vv_weekly_html_hash($subject, $html, $text, $layout_version) {
    $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
    if (defined('JSON_UNESCAPED_LINE_TERMINATORS')) $flags |= JSON_UNESCAPED_LINE_TERMINATORS;
    $canonical = json_encode(array('subject' => $subject, 'html' => $html, 'text' => $text, 'layoutVersion' => $layout_version), $flags);
    if ($canonical === false) throw new Exception('The HTML timesheet contains invalid UTF-8 content.');
    return hash('sha256', $canonical);
}
function vv_weekly_final_recipients($mailer, $weekly) {
    $to = $mailer->getToAddresses();
    if (count($to) !== 1 || ($to[0][0] ?? '') !== $weekly['recipient'] || count($mailer->getCcAddresses()) ||
        count($mailer->getBccAddresses()) || count($mailer->getAllRecipientAddresses()) !== 1) {
        throw new Exception('Weekly recipient privacy was changed by a mail hook. Review the original request; no automatic resend is permitted.');
    }
}
function vv_weekly_final_html($mailer, $data, $weekly, $final = false) {
    $types = $final ? array('text/html', 'multipart/alternative') : array('text/html');
    if ($mailer->Subject !== $data['subject'] || $mailer->Body !== $data['html'] ||
        $mailer->AltBody !== $data['text'] || !in_array(strtolower($mailer->ContentType), $types, true) ||
        count($mailer->getAttachments()) !== 0 ||
        !hash_equals($weekly['contentHash'], vv_weekly_html_hash($mailer->Subject, $mailer->Body, $mailer->AltBody, $weekly['layoutVersion']))) {
        throw new Exception('The HTML timesheet body, alternative or attachment policy changed in the final mail transport. Review the original request before retry.');
    }
}
function vv_pdf_relay_send($request) {
    $data = $request->get_json_params();
    if (!is_array($data)) return new WP_Error('INVALID_REQUEST_ID', 'A JSON message and stable request identity are required.', array('status' => 422));
    $request_id = (string)($data['request_id'] ?? '');
    if (!preg_match('/^[a-zA-Z0-9:_-]{1,180}$/', $request_id)) return new WP_Error('INVALID_REQUEST_ID', 'A stable request identity is required.', array('status' => 422));
    $key = 'vv_mail_' . hash('sha256', $request_id);
    $weekly_html = is_array($data['delivery_policy'] ?? null) && ($data['delivery_policy']['format'] ?? null) === 'HTML';
    // Bind accepted receipts to the complete message. A completed request may
    // never be reused to rewrite its recipient, body or document version.
    $fingerprint_json = json_encode(array('to' => $data['to'] ?? array(), 'cc' => $data['cc'] ?? array(),
        'bcc' => $data['bcc'] ?? array(), 'reply_to' => $data['reply_to'] ?? null,
        'subject' => $data['subject'] ?? '', 'html' => $data['html'] ?? '', 'text' => $data['text'] ?? '',
        'delivery_policy' => $data['delivery_policy'] ?? null, 'attachments' => $data['attachments'] ?? array()));
    if ($fingerprint_json === false) return new WP_Error('INVALID_REQUEST_ID', 'The message cannot be represented safely.', array('status' => 422));
    $fingerprint = hash('sha256', $fingerprint_json);
    $previous = get_option($key);
    if (is_array($previous) && ($previous['state'] ?? '') === 'ACCEPTED') {
        $stored_fingerprint = $previous['request_fingerprint'] ?? null;
        if (($stored_fingerprint !== null && (!is_string($stored_fingerprint) || !hash_equals($stored_fingerprint, $fingerprint))) ||
            ($weekly_html && $stored_fingerprint === null) || !is_array($previous['result'] ?? null)) {
            return new WP_Error('DELIVERY_REVIEW_REQUIRED', 'This identity already has an accepted message with different or unverified content. It was not sent or rewritten.', array('status' => 409, 'previous_provider_accepted' => true));
        }
        return $previous['result'];
    }
    if (!add_option($key, array('state' => 'PROCESSING', 'request_fingerprint' => $fingerprint, 'created_at' => gmdate('c')), '', false)) {
        return new WP_Error('DELIVERY_REVIEW_REQUIRED', 'This request is in progress or its outcome requires administrator review. It was not sent again.', array('status' => 409));
    }
    $attempted = false;
    try {
        if ($weekly_html && (!is_array($data['attachments'] ?? array()) || count($data['attachments'] ?? array()) !== 0)) throw new Exception('HTML-only weekly reports cannot contain attachments.');
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
                count($recipients) !== 1 || $recipients[0] !== ($weekly['recipient'] ?? '') || !empty($data['cc']) || !empty($data['bcc'])) throw new Exception('Weekly timesheets require one exact designated recipient, no copies and a stable staff/period/version policy.');
            $format = $weekly['format'] ?? 'PDF';
            if (!in_array($format, array('HTML', 'PDF'), true)) throw new Exception('The weekly timesheet delivery format is unsupported.');
            if ($format === 'PDF' && count($parts) !== 1) throw new Exception('PDF weekly reports require one validated PDF attachment.');
            if ($format === 'HTML') {
                if ((int)($data['weekly_html_contract_version'] ?? 0) !== 1 || ($weekly['layoutVersion'] ?? '') !== 'weekly-html-v1' ||
                    !preg_match('/^[a-f0-9]{64}$/', (string)($weekly['contentHash'] ?? '')) ||
                    !is_string($data['subject'] ?? null) || !is_string($data['html'] ?? null) || !is_string($data['text'] ?? null) ||
                    $data['subject'] !== sanitize_text_field($data['subject']) || trim($data['subject']) === '' || preg_match('/[\r\n\x00]/', $data['subject']) ||
                    trim($data['html']) === '' || trim($data['text']) === '' || strlen($data['subject']) > 998 ||
                    strlen($data['html']) > 1024 * 1024 || strlen($data['text']) > 512 * 1024 ||
                    preg_match('~<(?:script|iframe|object|embed|form|input|button|svg|link|base)\b|<[^>]+\son[a-z]+\s*=|\b(?:href|src)\s*=\s*[\x22\x27]\s*(?:javascript|data):~i', $data['html']) || count($parts) !== 0 ||
                    !hash_equals($weekly['contentHash'], vv_weekly_html_hash($data['subject'], $data['html'], $data['text'], $weekly['layoutVersion']))) {
                    throw new Exception('A complete immutable HTML timesheet and plain-text alternative with matching content identity are required.');
                }
                if (!vv_pdf_relay_health()['weekly_html_content_preserved']) throw new Exception('The active mail adapter bypasses the verified HTML body or recipient contract. Review its transport before enabling HTML timesheets.');
            }
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
                vv_weekly_final_recipients($mailer, $weekly);
            }
            $mailer->clearAttachments();
            foreach ($parts as $part) {
                if (!$mailer->addStringAttachment($part['bytes'], $part['name'], 'base64', 'application/pdf', 'attachment')) throw new Exception('PHPMailer could not attach the validated PDF bytes.');
            }
            $mailer->AltBody = (string)($data['text'] ?? '');
            if ($weekly && ($weekly['format'] ?? 'PDF') === 'HTML') vv_weekly_final_html($mailer, $data, $weekly);
            $observed_mailer = $mailer;
        };
        add_action('phpmailer_init', $attach, PHP_INT_MAX);
        $attempted = true;
        try { $accepted = wp_mail($recipients, sanitize_text_field($data['subject'] ?? ''), (string)(($data['html'] ?? '') ?: nl2br(esc_html($data['text'] ?? ''))), $headers); }
        finally { remove_action('phpmailer_init', $attach, PHP_INT_MAX); }
        if (!$accepted) {
            update_option($key, array('state' => 'REVIEW_REQUIRED', 'request_fingerprint' => $fingerprint, 'created_at' => gmdate('c')), false);
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
            vv_weekly_final_recipients($observed_mailer, $weekly);
            if (($weekly['format'] ?? 'PDF') === 'HTML') vv_weekly_final_html($observed_mailer, $data, $weekly, true);
        }
        $result = array('sent' => true, 'provider_accepted' => true, 'recipient_verified' => false, 'request_id' => $request_id,
            'attachment_contract_version' => 3, 'attachment_filename_preserved' => true, 'pdf_bytes_validated' => true,
            'weekly_recipient_privacy_enforced' => $weekly !== null, 'designated_recipient' => $weekly ? $weekly['recipient'] : null,
            'attachments' => array_map(function ($part) { return array('filename' => $part['name'], 'contentType' => 'application/pdf', 'byte_length' => strlen($part['bytes']), 'sha256' => hash('sha256', $part['bytes']), 'pages' => $part['pages']); }, $parts));
        if ($weekly_html) {
            $result['weekly_html_contract_version'] = 1;
            $result['weekly_html_content_preserved'] = true;
            $result['weekly_html_sha256'] = $weekly['contentHash'];
            $result['layout_version'] = $weekly['layoutVersion'];
            // These attachment-only flags are not evidence for an HTML send.
            $result['pdf_bytes_validated'] = false;
            // A MIME Message-ID is traceable, but is not an inbox receipt.
            if ($observed_mailer && method_exists($observed_mailer, 'getLastMessageID')) {
                $message_id = (string)$observed_mailer->getLastMessageID();
                if ($message_id !== '') $result['message_id'] = $message_id;
            }
        }
        update_option($key, array('state' => 'ACCEPTED', 'request_fingerprint' => $fingerprint, 'result' => $result), false);
        return $result;
    } catch (Throwable $error) {
        if (!$attempted) delete_option($key);
        else update_option($key, array('state' => 'REVIEW_REQUIRED', 'request_fingerprint' => $fingerprint, 'created_at' => gmdate('c')), false);
        return new WP_Error($attempted ? 'DELIVERY_REVIEW_REQUIRED' : ($weekly_html ? 'WEEKLY_HTML_RELAY_VALIDATION_FAILED' : 'PDF_RELAY_VALIDATION_FAILED'), $error->getMessage(), array('status' => 422, 'provider_accepted' => isset($accepted) && $accepted === true));
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
