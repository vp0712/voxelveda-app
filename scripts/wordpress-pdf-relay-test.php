<?php
// Isolated WordPress receiver contract. No network, provider or real inbox is used.
$vv_autoloader = require __DIR__ . '/../deployment/wordpress/vendor/autoload.php';
// A second invocation proves that HTML mail has no runtime PDF-parser need.
// Load only the real MIME builder before disabling Composer discovery.
if (getenv('VV_RELAY_HTML_ONLY_WITHOUT_PDF_PARSER') === '1') {
    class_exists('\\PHPMailer\\PHPMailer\\PHPMailer');
    class_exists('\\PHPMailer\\PHPMailer\\Exception');
    $vv_autoloader->unregister();
}
define('ABSPATH', __DIR__);
define('VOXEL_VEDA_MAIL_RELAY_TOKEN', hash('sha256', 'disposable-relay-fixture'));
$vv_options = array(); $vv_hooks = array(); $vv_attempts = 0; $vv_mode = 'accepted'; $vv_mime = ''; $vv_interceptor=false;
class WP_Error {
    public $code, $message, $data;
    function __construct($code, $message, $data) { $this->code=$code; $this->message=$message; $this->data=$data; }
}
function get_option($key) { return $GLOBALS['vv_options'][$key] ?? false; }
function add_option($key, $value, $unused='', $autoload=false) {
    if (array_key_exists($key, $GLOBALS['vv_options'])) return false;
    $GLOBALS['vv_options'][$key]=$value; return true;
}
function update_option($key, $value, $autoload=false) { $GLOBALS['vv_options'][$key]=$value; return true; }
function delete_option($key) { unset($GLOBALS['vv_options'][$key]); return true; }
function add_action($name, $callback, $priority=10) { $GLOBALS['vv_hooks'][$name][$priority][]=$callback; }
function remove_action($name, $callback, $priority=10) {
    foreach (($GLOBALS['vv_hooks'][$name][$priority] ?? array()) as $index=>$item) if ($item === $callback) unset($GLOBALS['vv_hooks'][$name][$priority][$index]);
}
function register_rest_route($namespace, $path, $options) { }
function has_filter($name) { return $name==='pre_wp_mail' && $GLOBALS['vv_interceptor'] ? 10 : false; }
function is_email($address) { return filter_var($address, FILTER_VALIDATE_EMAIL); }
function sanitize_text_field($value) { return trim(str_replace(array("\r", "\n"), ' ', strip_tags((string)$value))); }
function esc_html($value) { return htmlspecialchars($value, ENT_QUOTES, 'UTF-8'); }
function wp_mail($recipients, $subject, $body, $headers) {
    $GLOBALS['vv_attempts']++;
    $mail = new \PHPMailer\PHPMailer\PHPMailer(true);
    $mail->CharSet='UTF-8'; $mail->setFrom('info@voxelveda.com', 'Voxel Veda');
    foreach ($recipients as $recipient) $mail->addAddress($recipient);
    $mail->Subject=$subject; $mail->Body=$body; $mail->isHTML(true);
    // A stale attachment must be cleared by the receiver's final hook.
    $mail->addStringAttachment('not a PDF', 'stale.tmp');
    if ($GLOBALS['vv_mode']==='extra-to') $mail->addAddress('unrelated@example.invalid');
    if ($GLOBALS['vv_mode']==='default-cc') $mail->addCC('manager@example.invalid');
    if ($GLOBALS['vv_mode']==='default-bcc') $mail->addBCC('payroll@example.invalid');
    if ($GLOBALS['vv_mode']==='pre-altered-html') $mail->Body.='<p>Unrelated content inserted by a prior hook.</p>';
    $hooks=$GLOBALS['vv_hooks']['phpmailer_init'] ?? array(); ksort($hooks);
    if ($GLOBALS['vv_mode']!=='missing-hook') foreach ($hooks as $callbacks) foreach ($callbacks as $callback) $callback($mail);
    if ($GLOBALS['vv_mode']==='altered-parts') { $mail->clearAttachments(); $mail->addStringAttachment('modified bytes', 'modified.pdf', 'base64', 'application/pdf', 'attachment'); }
    if ($GLOBALS['vv_mode']==='altered-html') $mail->Body.='<p>Unrelated content inserted after the final hook.</p>';
    if ($GLOBALS['vv_mode']==='altered-text') $mail->AltBody.="\nUnrelated plain-text content.";
    if ($GLOBALS['vv_mode']==='altered-subject') $mail->Subject.=' altered';
    $mail->preSend(); // Build genuine PHPMailer MIME without invoking a transport.
    $GLOBALS['vv_mime']=$mail->getSentMIMEMessage();
    if ($GLOBALS['vv_mode']==='exception') throw new RuntimeException('Simulated uncertain provider response');
    return in_array($GLOBALS['vv_mode'],array('accepted','missing-hook','altered-parts','extra-to','default-cc','default-bcc','altered-html','altered-text','altered-subject','pre-altered-html'),true);
}
class FixtureRequest {
    public $data; function __construct($data) { $this->data=$data; }
    function get_json_params() { return $this->data; }
    function get_header($name) { return VOXEL_VEDA_MAIL_RELAY_TOKEN; }
}
function verify($value, $message) { if (!$value) throw new RuntimeException($message); }
require __DIR__ . '/../deployment/wordpress/voxel-veda-pdf-relay.php';
if (getenv('VV_RELAY_HTML_ONLY_WITHOUT_PDF_PARSER') === '1') {
    verify(!class_exists('\\Smalot\\PdfParser\\Parser'), 'This isolated HTML-only invocation must not have a PDF parser.');
    verify(vv_pdf_relay_health()['pdf_bytes_validated']===false, 'Missing parser must still disable PDF capability.');
    verify(vv_pdf_relay_health()['weekly_html_content_preserved']===true, 'HTML body capability must remain available without a PDF parser.');
    vv_verify_weekly_html_receiver();
    echo 'WordPress HTML-only receiver passed without a PDF parser or PDF fixture; genuine multipart alternative MIME and private immutable content verified. No network or received inbox used.'.PHP_EOL;
    exit(0);
}
$filename=getenv('PDF_FIXTURE_PATH') ?: '/fixtures/invoice.pdf';
$bytes=file_get_contents($filename); verify($bytes!==false, 'The generated PDF fixture is required.');
$part=array('filename'=>'voxel-veda-fixture-invoice.pdf', 'contentType'=>'application/pdf', 'content_base64'=>base64_encode($bytes), 'byte_length'=>strlen($bytes), 'sha256'=>hash('sha256',$bytes));
$data=array('request_id'=>'isolated:accepted', 'to'=>array('fixture@example.invalid'), 'subject'=>'Isolated PDF receiver verification', 'text'=>'A validated fixture PDF is attached.', 'attachments'=>array($part));
verify(vv_pdf_relay_health()['pdf_bytes_validated']===true, 'The actual PHP PDF parser must be installed.');
verify(vv_pdf_relay_permission(new FixtureRequest($data)), 'Fixture token contract failed.');
$result=vv_pdf_relay_send(new FixtureRequest($data));
verify(is_array($result) && $result['provider_accepted']===true && $result['recipient_verified']===false, 'Acceptance must remain distinct from receipt.');
verify($result['attachments'][0]['pages']>=1 && $result['attachments'][0]['sha256']===$part['sha256'], 'Actual PHP parser and exact PDF identity failed.');
verify($GLOBALS['vv_attempts']===1, 'Exactly one provider attempt expected.');
$mime=$GLOBALS['vv_mime'];
if (getenv('PDF_RELAY_MIME_OUTPUT')) file_put_contents(getenv('PDF_RELAY_MIME_OUTPUT'),$mime);
verify(strpos($mime, 'filename=voxel-veda-fixture-invoice.pdf')!==false || strpos($mime, 'filename="voxel-veda-fixture-invoice.pdf"')!==false, 'Recipient MIME filename must end in .pdf.');
verify(strpos($mime,'Content-Type: application/pdf')!==false && strpos($mime,'Content-Disposition: attachment')!==false, 'PDF MIME metadata missing.');
verify(strpos($mime,'stale.tmp')===false, 'No stale or non-PDF attachment may remain.');
verify(substr_count($mime,'Content-Disposition: attachment')===1, 'Exactly one PDF attachment expected.');
$normalized=str_replace("\r\n", "\n", $mime);
$start=strpos($normalized,'Content-Type: application/pdf');
$bodyStart=$start===false ? false : strpos($normalized,"\n\n",$start);
$bodyEnd=$bodyStart===false ? false : strpos($normalized,"\n--",$bodyStart+2);
verify($bodyStart!==false && $bodyEnd!==false, 'Actual MIME PDF part not found.');
$encoded=substr($normalized,$bodyStart+2,$bodyEnd-$bodyStart-2);
$decoded=base64_decode(str_replace(array("\n", "\r", " ", "\t"), '', $encoded),true);
verify($decoded===$bytes, 'Decoded recipient attachment must equal the authoritative PDF bytes.');
verify(count((new \Smalot\PdfParser\Parser())->parseContent($decoded)->getPages())>=1, 'Decoded MIME must parse as a PDF.');
vv_pdf_relay_send(new FixtureRequest($data)); verify($GLOBALS['vv_attempts']===1, 'Accepted retries must not send again.');
foreach (array('filename'=>'invalid.tmp','contentType'=>'text/html','content_base64'=>base64_encode('<html>Error</html>'),'sha256'=>str_repeat('0',64)) as $field=>$value) {
    $bad=$data; $bad['request_id']='isolated:invalid:'.$field; $bad['attachments'][0][$field]=$value;
    $failure=vv_pdf_relay_send(new FixtureRequest($bad));
    verify($failure instanceof WP_Error && $failure->code==='PDF_RELAY_VALIDATION_FAILED', 'Invalid PDF attachment must fail before transport.');
    verify($GLOBALS['vv_attempts']===1, 'Validation failure must not send a misleading email.');
}
$GLOBALS['vv_interceptor']=true;
verify(vv_pdf_relay_health()['native_pdf_mime_supported']===false, 'An intercepting API mail plugin must not claim native PDF MIME support.');
$intercepted=$data; $intercepted['request_id']='isolated:intercepted';
$failure=vv_pdf_relay_send(new FixtureRequest($intercepted));
verify($failure instanceof WP_Error && $failure->code==='PDF_RELAY_VALIDATION_FAILED' && $GLOBALS['vv_attempts']===1, 'Intercepting mail hooks must fail before a document attempt.');
$GLOBALS['vv_interceptor']=false;
foreach (array('false','exception','missing-hook','altered-parts') as $mode) {
    $GLOBALS['vv_mode']=$mode; $uncertain=$data; $uncertain['request_id']='isolated:uncertain:'.$mode;
    $before=$GLOBALS['vv_attempts']; $failure=vv_pdf_relay_send(new FixtureRequest($uncertain));
    verify($failure instanceof WP_Error && $failure->code==='DELIVERY_REVIEW_REQUIRED', 'Uncertain acceptance must require review.');
    if (in_array($mode,array('missing-hook','altered-parts'),true)) verify($failure->data['provider_accepted']===true, 'Known acceptance must survive the attachment review failure.');
    vv_pdf_relay_send(new FixtureRequest($uncertain));
    verify($GLOBALS['vv_attempts']===$before+1, 'Uncertain retries must not automatically send again.');
}

$GLOBALS['vv_mode']='accepted';
$weekly=$data; $weekly['request_id']='weekly-timesheet:31:2026-09-28:2026-10-04:v1';
$weekly['delivery_policy']=array('type'=>'WEEKLY_TIMESHEET','staffId'=>31,'deliveryId'=>81,'revision'=>1,'fromDate'=>'2026-09-28','toDate'=>'2026-10-04','sourceHash'=>hash('sha256','isolated snapshot'),'recipient'=>'fixture@example.invalid');
$accepted=vv_pdf_relay_send(new FixtureRequest($weekly));
verify(is_array($accepted) && $accepted['weekly_recipient_privacy_enforced']===true && $accepted['designated_recipient']==='fixture@example.invalid','Single designated final recipient must be confirmed.');
verify(!preg_match('/^(?:Cc|Bcc):/mi',$GLOBALS['vv_mime']),'Weekly MIME cannot contain copies.');
verify(preg_match('/^To:\s*fixture@example\.invalid\s*$/m',$GLOBALS['vv_mime']),'Weekly MIME must contain exactly the designated To mailbox.');
foreach(array('extra-to','default-cc','default-bcc') as $index=>$mode) {
 $GLOBALS['vv_mode']=$mode; $bad=$weekly; $bad['delivery_policy']['staffId']=40+$index; $bad['request_id']='weekly-timesheet:'.(40+$index).':2026-09-28:2026-10-04:v1';
 $before=$GLOBALS['vv_attempts']; $blocked=vv_pdf_relay_send(new FixtureRequest($bad));
 verify($blocked instanceof WP_Error && $blocked->code==='DELIVERY_REVIEW_REQUIRED','Any final recipient expansion must fail closed before provider transport.');
 vv_pdf_relay_send(new FixtureRequest($bad));verify($GLOBALS['vv_attempts']===$before+1,'An unsafe/uncertain weekly message must never be automatically attempted again.');
}
$GLOBALS['vv_mode']='accepted';$bad=$weekly;$bad['request_id']='weekly-timesheet:99:2026-09-28:2026-10-04:v1';$bad['delivery_policy']['staffId']=99;$bad['cc']=array('manager@example.invalid');$before=$GLOBALS['vv_attempts'];
$blocked=vv_pdf_relay_send(new FixtureRequest($bad));verify($blocked instanceof WP_Error && $blocked->code==='PDF_RELAY_VALIDATION_FAILED' && $GLOBALS['vv_attempts']===$before,'Weekly copies must fail before any mail attempt.');
vv_verify_weekly_html_receiver();
echo 'WordPress receiver tests passed: real PHP PDF parser; genuine PHPMailer PDF and HTML/plain-text MIME; exact decoded bytes and body content; PDF-only attachment metadata; HTML with zero attachments; stale attachment removal; validation prevents send; accepted/uncertain retries never duplicate; recipient receipt unverified.'.PHP_EOL;

function vv_decode_alternative($mime, $type) {
    $normalized = str_replace("\r\n", "\n", $mime);
    $pattern = '~(?:^|\n)--[^\n]+\n(Content-Type: '.preg_quote($type, '~').'[^\n]*\n(?:[^\n]+\n)*)\n([\s\S]*?)(?=\n--[^\n]+)~i';
    if (!preg_match($pattern, $normalized, $match)) throw new RuntimeException('The real MIME is missing its '.$type.' alternative.');
    $headers = $match[1]; $body = $match[2];
    if (preg_match('/Content-Transfer-Encoding:\s*base64/i', $headers)) {
        $body = base64_decode(preg_replace('/\s+/', '', $body), true);
        verify($body!==false, 'The MIME alternative must have valid base64 bytes.');
    } elseif (preg_match('/Content-Transfer-Encoding:\s*quoted-printable/i', $headers)) $body = quoted_printable_decode($body);
    // MIME uses CRLF and adds a boundary separator. Compare content after only
    // protocol line-ending normalization, never HTML sanitization/truncation.
    return rtrim(str_replace("\r\n", "\n", $body), "\n");
}
function vv_verify_weekly_html_receiver() {
    $file = getenv('WEEKLY_HTML_FIXTURE_PATH') ?: '/tmp/voxel-weekly-html-evidence/report.json';
    $json = file_get_contents($file); verify($json!==false, 'Generate the real JavaScript HTML report fixture before PHP receiver verification.');
    $report = json_decode($json, true); verify(is_array($report), 'The real renderer fixture must contain valid JSON.');
    verify(vv_weekly_html_hash($report['subject'], $report['html'], $report['text'], $report['layoutVersion'])===$report['contentHash'], 'PHP and JavaScript must hash the exact same ordered Unicode HTML/text content.');
    $message = array('request_id'=>'weekly-timesheet:131:2026-09-28:2026-10-04:v1', 'to'=>array('fixture@example.invalid'),
        'cc'=>array(), 'bcc'=>array(), 'subject'=>$report['subject'], 'html'=>$report['html'], 'text'=>$report['text'], 'attachments'=>array(),
        'weekly_html_contract_version'=>1, 'delivery_policy'=>array('type'=>'WEEKLY_TIMESHEET', 'format'=>'HTML', 'staffId'=>131,
            'deliveryId'=>181, 'revision'=>1, 'fromDate'=>'2026-09-28', 'toDate'=>'2026-10-04', 'sourceHash'=>hash('sha256', 'isolated HTML source'),
            'recipient'=>'fixture@example.invalid', 'layoutVersion'=>$report['layoutVersion'], 'contentHash'=>$report['contentHash']));
    $GLOBALS['vv_mode']='accepted'; $GLOBALS['vv_interceptor']=false; $before=$GLOBALS['vv_attempts'];
    $accepted=vv_pdf_relay_send(new FixtureRequest($message));
    verify(is_array($accepted) && $accepted['provider_accepted']===true && $accepted['recipient_verified']===false, 'HTML provider acceptance is not recipient receipt.');
    verify($accepted['weekly_html_contract_version']===1 && $accepted['weekly_html_content_preserved']===true &&
        $accepted['weekly_html_sha256']===$report['contentHash'] && $accepted['layout_version']===$report['layoutVersion'] &&
        $accepted['request_id']===$message['request_id'] && $accepted['weekly_recipient_privacy_enforced']===true &&
        $accepted['designated_recipient']==='fixture@example.invalid' && $accepted['attachments']===array() && $accepted['pdf_bytes_validated']===false, 'HTML receipt must bind its version/content and zero-attachment policy independently of PDFs.');
    verify($GLOBALS['vv_attempts']===$before+1, 'One HTML transport attempt expected.');
    $mime=$GLOBALS['vv_mime'];
    if (getenv('WEEKLY_HTML_RELAY_MIME_OUTPUT')) file_put_contents(getenv('WEEKLY_HTML_RELAY_MIME_OUTPUT'),$mime);
    verify(strpos($mime,'multipart/alternative')!==false, 'The received-format fixture must contain HTML and plain text alternatives.');
    verify(strpos($mime,'Content-Disposition: attachment')===false && strpos($mime,'stale.tmp')===false, 'HTML-only MIME cannot contain PDF, TMP, logo or other attachments.');
    verify(!preg_match('/^(?:Cc|Bcc):/mi',$mime) && preg_match('/^To:\s*fixture@example\.invalid\s*$/m',$mime), 'HTML MIME must have exactly the designated To and no copies.');
    verify(vv_decode_alternative($mime,'text/html')===rtrim(str_replace("\r\n", "\n", $report['html']),"\n"), 'The full decoded HTML must equal the authoritative renderer snapshot.');
    verify(vv_decode_alternative($mime,'text/plain')===rtrim(str_replace("\r\n", "\n", $report['text']),"\n"), 'The full decoded plain text must equal the authoritative renderer snapshot.');
    verify(strpos($report['html'],'alt="Voxel Veda"')!==false && strpos($report['text'],'Voxel Veda Pty Ltd')!==false && strpos($report['text'],'DAILY TOTALS')!==false, 'The report must remain useful with external images blocked.');
    vv_pdf_relay_send(new FixtureRequest($message)); verify($GLOBALS['vv_attempts']===$before+1, 'Accepted HTML retries cannot deliver again.');
    $changed=$message; $changed['html'].='<p>A different report.</p>';
    $changed['delivery_policy']['contentHash']=vv_weekly_html_hash($changed['subject'],$changed['html'],$changed['text'],$changed['delivery_policy']['layoutVersion']);
    $blocked=vv_pdf_relay_send(new FixtureRequest($changed));
    verify($blocked instanceof WP_Error && $blocked->code==='DELIVERY_REVIEW_REQUIRED' && $GLOBALS['vv_attempts']===$before+1, 'An accepted identity cannot be rewritten with a changed report.');
    $changed=$message; $changed['to']=array('different@example.invalid'); $changed['delivery_policy']['recipient']='different@example.invalid';
    $blocked=vv_pdf_relay_send(new FixtureRequest($changed));
    verify($blocked instanceof WP_Error && $blocked->code==='DELIVERY_REVIEW_REQUIRED' && $GLOBALS['vv_attempts']===$before+1, 'Completed delivery recipients cannot be rewritten.');
    verify(vv_pdf_relay_send(new FixtureRequest($message))===$accepted, 'The original accepted receipt must remain unchanged.');

    $sequence=140;
    foreach (array('html','text','subject','contentHash','layoutVersion','cc','bcc','attachments','missing-contract','missing-format','wrong-format','unsafe-html','header-injection','oversized-html') as $field) {
        $bad=$message; $sequence++; $bad['delivery_policy']['staffId']=$sequence; $bad['request_id']='weekly-timesheet:'.$sequence.':2026-09-28:2026-10-04:v1';
        if (in_array($field,array('html','text','subject'),true)) $bad[$field].=' changed';
        elseif ($field==='contentHash') $bad['delivery_policy']['contentHash']=str_repeat('0',64);
        elseif ($field==='layoutVersion') $bad['delivery_policy']['layoutVersion']='unapproved-layout';
        elseif ($field==='cc' || $field==='bcc') $bad[$field]=array('unrelated@example.invalid');
        elseif ($field==='attachments') $bad['attachments']=array(array('filename'=>'forbidden.tmp','contentType'=>'text/html','content_base64'=>base64_encode('not PDF')));
        elseif ($field==='missing-contract') unset($bad['weekly_html_contract_version']);
        elseif ($field==='missing-format') unset($bad['delivery_policy']['format']);
        elseif ($field==='wrong-format') $bad['delivery_policy']['format']='HTML_PDF';
        elseif ($field==='unsafe-html') { $bad['html'].='<script>unsafe</script>'; $bad['delivery_policy']['contentHash']=vv_weekly_html_hash($bad['subject'],$bad['html'],$bad['text'],$bad['delivery_policy']['layoutVersion']); }
        elseif ($field==='header-injection') { $bad['subject'].="\r\nBcc: unrelated@example.invalid"; $bad['delivery_policy']['contentHash']=vv_weekly_html_hash($bad['subject'],$bad['html'],$bad['text'],$bad['delivery_policy']['layoutVersion']); }
        elseif ($field==='oversized-html') { $bad['html']=str_repeat('x',1024*1024+1); $bad['delivery_policy']['contentHash']=vv_weekly_html_hash($bad['subject'],$bad['html'],$bad['text'],$bad['delivery_policy']['layoutVersion']); }
        $count=$GLOBALS['vv_attempts'];$failure=vv_pdf_relay_send(new FixtureRequest($bad));
        verify($failure instanceof WP_Error && in_array($failure->code,array('WEEKLY_HTML_RELAY_VALIDATION_FAILED','PDF_RELAY_VALIDATION_FAILED'),true) && $GLOBALS['vv_attempts']===$count, 'Invalid HTML report metadata/body/policy must fail before transport: '.$field);
    }
    $GLOBALS['vv_interceptor']=true;
    verify(vv_pdf_relay_health()['weekly_html_content_preserved']===false && vv_pdf_relay_health()['weekly_recipient_privacy_enforced']===false, 'A bypassing API adapter cannot advertise HTML content/privacy support.');
    $bad=$message; $bad['delivery_policy']['staffId']=160;$bad['request_id']='weekly-timesheet:160:2026-09-28:2026-10-04:v1';$count=$GLOBALS['vv_attempts'];
    $failure=vv_pdf_relay_send(new FixtureRequest($bad));
    verify($failure instanceof WP_Error && $failure->code==='WEEKLY_HTML_RELAY_VALIDATION_FAILED' && $GLOBALS['vv_attempts']===$count, 'HTML privacy/content preflight failure cannot attempt transport.');
    $GLOBALS['vv_interceptor']=false;
    foreach (array('false','exception','missing-hook','altered-html','altered-text','altered-subject','pre-altered-html','altered-parts','extra-to','default-cc','default-bcc') as $index=>$mode) {
        $GLOBALS['vv_mode']=$mode;$bad=$message;$staff=170+$index;$bad['delivery_policy']['staffId']=$staff;$bad['request_id']='weekly-timesheet:'.$staff.':2026-09-28:2026-10-04:v1';$count=$GLOBALS['vv_attempts'];
        $failure=vv_pdf_relay_send(new FixtureRequest($bad));
        verify($failure instanceof WP_Error && $failure->code==='DELIVERY_REVIEW_REQUIRED', 'Uncertain or altered HTML transport must be held for review: '.$mode);
        if (in_array($mode,array('missing-hook','altered-html','altered-text','altered-subject','altered-parts'),true)) verify($failure->data['provider_accepted']===true, 'Known acceptance must survive HTML content review failure.');
        vv_pdf_relay_send(new FixtureRequest($bad));
        verify($GLOBALS['vv_attempts']===$count+1, 'A lost/unsafe HTML outcome cannot be attempted automatically again: '.$mode);
    }
    $GLOBALS['vv_mode']='accepted';
}
