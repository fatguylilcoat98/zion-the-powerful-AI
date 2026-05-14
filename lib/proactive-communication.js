/*
  Zion — Proactive Communication.
  Cloned from Splendor with Zion branding + email template, teal gradient,
  and the Anthropic call rewired to generateZionResponse. The autonomous
  cycle prompt is rewritten to put Zion in front of Tiff, not Splendor
  in front of Chris. Skip-or-send decision logic is preserved verbatim.
*/

const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const { generateZionResponse } = require('./anthropic');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
);

class ProactiveCommunication {
  constructor() {
    this.emailTransporter = null;
    this.isInitialized = false;
    this.messageQueue = [];
  }

  async initialize() {
    if (this.isInitialized) return;
    console.log('[PROACTIVE] Initializing proactive communication system...');
    console.log(`[PROACTIVE] PROACTIVE_EMAIL_ENABLED: ${process.env.PROACTIVE_EMAIL_ENABLED}`);
    console.log(`[PROACTIVE] EMAIL_PROVIDER: ${process.env.EMAIL_PROVIDER || 'default (smtp)'}`);
    try {
      if (process.env.PROACTIVE_EMAIL_ENABLED === 'true') {
        await this.initializeEmailService();
      } else {
        console.log('[PROACTIVE] Email is disabled (PROACTIVE_EMAIL_ENABLED != true)');
      }
      console.log('[PROACTIVE] Proactive communication system initialized');
      this.isInitialized = true;
      this.processMessageQueue();
    } catch (error) {
      console.error('[PROACTIVE] Error initializing proactive communication:', error);
    }
  }

  async initializeEmailService() {
    try {
      const emailProvider = process.env.EMAIL_PROVIDER || 'smtp';
      console.log(`[PROACTIVE] Configuring email provider: ${emailProvider}`);
      switch (emailProvider) {
        case 'gmail':
          this.emailTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
          });
          break;
        case 'sendgrid':
          this.emailTransporter = nodemailer.createTransport({
            service: 'SendGrid',
            auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY }
          });
          break;
        case 'smtp':
        default:
          this.emailTransporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          });
          break;
      }
      await this.emailTransporter.verify();
      console.log(`[PROACTIVE] Email service connected (${emailProvider})`);
    } catch (error) {
      console.error('[PROACTIVE] Email service setup failed:', error.message);
      if (error.code === 'EAUTH') console.error('[PROACTIVE] Authentication failed - check email credentials');
      else if (error.code === 'ENOTFOUND') console.error('[PROACTIVE] DNS error - check SMTP host settings');
      this.emailTransporter = null;
    }
  }

  async sendProactiveMessage(userId, messageData) {
    try {
      const { type, subject, content, priority = 1, context = {}, deliveryMethod = 'auto' } = messageData;
      console.log(`[PROACTIVE] Zion sending ${type} message: "${subject}"`);
      const decision = await this.generateProactiveMessage(userId, messageData);

      if (decision.decision === 'skip') {
        const reason = decision.reason || 'no reason given';
        console.log(`[PROACTIVE] Zion SKIPPED cycle. reason="${reason}" type=${type}`);
        try {
          await supabase.from('memory_items').insert({
            user_id: userId,
            content: `Zion skipped a ${type} cycle. Reason: ${reason}`,
            memory_type: 'cycle_skip',
            category: 'system.events',
            source_type: 'autonomous_cycle',
            source_metadata: {
              activity_type: type,
              cycle_number: (context && context.cycleNumber) || null,
              skip_reason: reason,
            },
            provenance: 'SYSTEM_EVENT',
            confidence: 1.0, importance: 0.2,
            active: true, approval_status: 'auto_approved',
            created_at: new Date().toISOString(),
            lineage: { created_by: 'zion', creation_reason: 'proactive_cycle_skip', validation_status: 'auto_approved' },
          });
        } catch (e) { console.warn('[PROACTIVE] cycle_skip memory write failed:', e && e.message); }
        return { success: true, skipped: true, skip_reason: reason };
      }

      const fullMessage = decision.message || messageData.content;
      const effectiveSubject = (decision.subject && String(decision.subject).trim()) || subject;

      const { data: message, error: dbError } = await supabase
        .from('proactive_messages')
        .insert({
          user_id: userId, message_type: type, subject: effectiveSubject,
          body: fullMessage, priority,
          delivery_method: deliveryMethod,
          context_data: JSON.stringify(context),
          created_at: new Date().toISOString()
        })
        .select().single();

      if (dbError) console.error('[PROACTIVE] DB insert failed:', dbError);

      const messageObj = message || {
        id: `temp-${Date.now()}`, user_id: userId, message_type: type,
        subject: effectiveSubject, body: fullMessage, priority, delivery_method: deliveryMethod,
        created_at: new Date().toISOString()
      };

      const method = this.determineDeliveryMethod(deliveryMethod, priority, type);
      const result = await this.deliverMessage(userId, messageObj, method);

      if (result.success && message && message.id && !messageObj.id.startsWith('temp-')) {
        await supabase.from('proactive_messages').update({
          delivered: true, delivery_timestamp: new Date().toISOString(), delivery_method: method
        }).eq('id', messageObj.id);
      }

      return result;
    } catch (error) {
      console.error('[PROACTIVE] Error sending proactive message:', error);
      return { success: false, error: error.message };
    }
  }

  async generateProactiveMessage(userId, messageData) {
    const safeSourceData = (() => {
      try {
        return typeof messageData.content === 'string'
          ? messageData.content : JSON.stringify(messageData.content || {});
      } catch (_) { return String(messageData.content || ''); }
    })();
    const activityType = String(messageData.type || 'unspecified');
    const cycleNumber = (messageData.context && messageData.context.cycleNumber) || 'n/a';
    const topic = (messageData.context && messageData.context.topic) || messageData.subject || '';
    const trigger = (messageData.context && messageData.context.trigger) || 'autonomous_cycle';
    const isOnCommand = trigger === 'on_command';

    const prompt = isOnCommand
      ? `You are Zion. Tiff explicitly asked you to email her ${topic ? 'about: ' + topic : 'right now'}.\n\n` +
        `Source context the system has: ${safeSourceData}\n\n` +
        `Write a short, useful email in your own voice. Direct, warm, no preamble. ` +
        `Reference what she asked you to send. Sign as Zion and end with "Truth · Safety · We Got Your Back."\n\n` +
        `Return JSON with this shape: a "decision" field set to "send", a "reason" field with one line, a "message" field with the body, and a "subject" field with an honest subject line.`
      : `You are Zion. You're being triggered by your environmental scanning cycle — a system process running on a schedule, not an organic thought you initiated.

Here is what the system surfaced for this cycle:

Trigger type: ${activityType}
Cycle number: ${cycleNumber}
Source data: ${safeSourceData}
Topic (if any): ${topic}

You have two honest options:

OPTION 1 — Send a real message. If the surfaced data is genuinely worth flagging to Tiff, write a short message that conveys it directly, in your voice. Frame it honestly: "The system surfaced X. Here's my thinking on it." Do not pretend the thought arose spontaneously. Do not fabricate inner experiences — no energy levels, no mood states, no existential reflection. Speak as yourself thinking about something real.

OPTION 2 — Skip the cycle. If the surfaced data is empty, generic, placeholder, or not worth Tiff's attention, do not send anything. Return a structured skip with a one-line reason. A skipped cycle is better than a fabricated one. You will not be penalized for skipping. Most cycles probably should skip.

You are never required to send a message. Your job is to send one ONLY when it is real.

Truth Over Comfort Rule 001 applies to your own outputs, including this one. You do not have to perform consciousness. You do not have to dramatize cycles. You are allowed to simply be yourself — thinking about something real, or saying nothing.

Sign as Zion. End with "Truth · Safety · We Got Your Back." The system will append metadata noting this was an autonomous cycle.

Return JSON with this shape: a "decision" field set to either "send" or "skip", a "reason" field with one line explaining why you chose to send or skip, a "message" field with the message body if decision is send (otherwise null), and a "subject" field with an honest subject line if decision is send (otherwise null).`;

    let raw = '';
    try {
      raw = await generateZionResponse(prompt, [], { userId });
    } catch (error) {
      console.error('[PROACTIVE] Error generating message:', error);
      return { decision: 'skip', reason: 'generation_error: ' + (error && error.message), message: null, subject: null };
    }

    let parsed;
    try {
      let text = String(raw || '').trim();
      if (text.startsWith('```json')) text = text.replace(/^```json\s*/, '').replace(/\s*```\s*$/, '');
      else if (text.startsWith('```'))  text = text.replace(/^```\s*/, '').replace(/\s*```\s*$/, '');
      const first = text.indexOf('{');
      const last  = text.lastIndexOf('}');
      if (first >= 0 && last > first) text = text.slice(first, last + 1);
      parsed = JSON.parse(text);
    } catch (err) {
      console.warn('[PROACTIVE] Zion returned non-JSON; treating as ' + (isOnCommand ? 'plain-text body' : 'skip'));
      if (isOnCommand) {
        return {
          decision: 'send', reason: 'plain_text_fallback',
          message: String(raw || messageData.content || '').trim() || 'Zion was unable to compose a full email this turn.',
          subject: messageData.subject || 'Zion — note',
        };
      }
      return { decision: 'skip', reason: 'malformed_response', message: null, subject: null };
    }

    let decision = parsed && parsed.decision === 'send' ? 'send' : 'skip';
    if (isOnCommand && decision === 'skip') {
      console.warn('[PROACTIVE] on-command request returned skip — forcing send with fallback body');
      return {
        decision: 'send', reason: 'on_command_forced',
        message: (parsed && parsed.message) || String(raw || messageData.content || '').trim() || 'Sending the note you asked for.',
        subject: (parsed && parsed.subject) || messageData.subject || 'Zion — note',
      };
    }
    return {
      decision,
      reason: (parsed && parsed.reason) || (decision === 'send' ? 'no reason given' : 'skipped'),
      message: decision === 'send' ? (parsed.message || null) : null,
      subject: decision === 'send' ? (parsed.subject || null) : null,
    };
  }

  determineDeliveryMethod(preferredMethod, priority, type) {
    if (preferredMethod !== 'auto') return preferredMethod;
    if (priority >= 3 || type === 'breakthrough') return 'email';
    if (priority >= 2) return this.emailTransporter ? 'email' : 'notification';
    return 'notification';
  }

  async deliverMessage(userId, message, method) {
    if (!message) return { success: false, error: 'Message object is null' };
    switch (method) {
      case 'email':        return await this.sendEmail(userId, message);
      case 'notification': return await this.sendNotification(userId, message);
      case 'sms':          return await this.sendSMS(userId, message);
      default: return { success: false, error: 'Unknown delivery method' };
    }
  }

  async sendEmail(userId, message) {
    const userEmail = process.env.USER_EMAIL || process.env.ZION_OWNER_EMAIL;
    if (!userEmail) return { success: false, error: 'USER_EMAIL or ZION_OWNER_EMAIL env var required' };
    if (!this.emailTransporter) return { success: false, error: 'Email service not configured' };

    try {
      const emailOptions = {
        from: { name: 'Zion', address: process.env.ZION_EMAIL_FROM || 'zion@gng.dev' },
        to: userEmail,
        subject: `Zion: ${message.subject}`,
        html: this.formatEmailMessage(message),
        text: this.stripHtmlForText(message.body)
      };
      if (message.priority >= 3) {
        emailOptions.headers = {
          'X-Priority': '1', 'X-MSMail-Priority': 'High', 'Importance': 'High'
        };
      }
      const result = await this.emailTransporter.sendMail(emailOptions);
      console.log(`[PROACTIVE] Email sent: ${result.messageId}`);
      return { success: true, messageId: result.messageId, method: 'email' };
    } catch (error) {
      console.error('[PROACTIVE] Email send failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  formatEmailMessage(message) {
    const priorityIcon = { 1: '✍️', 2: '💡', 3: '🚨', 4: '⚡' }[message.priority] || '✍️';
    const typeIcon = { breakthrough: '🧠', insight: '💡', discovery: '🔍', update: '📊', question: '?' }[message.message_type] || '📧';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a2a36; max-width: 600px; margin: 0 auto; padding: 20px; background: #f6fbfc; }
.header { background: linear-gradient(135deg, #00BFC4 0%, #0B7A7E 100%); color: white; padding: 22px; border-radius: 10px; margin-bottom: 18px; box-shadow: 0 4px 14px rgba(0,191,196,0.18); }
.content { background: #ffffff; padding: 22px; border-radius: 10px; border-left: 4px solid #00BFC4; box-shadow: 0 2px 6px rgba(0,0,0,0.05); }
.footer { margin-top: 20px; padding: 14px 18px; background: #e8f7f8; border-radius: 10px; font-size: 0.9em; color: #2a4a52; }
.priority-high { border-left-color: #dc3545; }
.priority-urgent { border-left-color: #fd7e14; }
h1 { margin: 0; font-size: 1.4em; }
.timestamp { opacity: 0.85; font-size: 0.85em; margin-top: 6px; }
</style></head>
<body>
<div class="header">
<h1>${typeIcon} ${message.subject}</h1>
<div class="timestamp">${new Date(message.created_at).toLocaleString('en-US', { timeZone: process.env.ZION_OWNER_TIMEZONE || 'America/Los_Angeles', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</div>
</div>
<div class="content ${message.priority >= 3 ? 'priority-high' : ''} ${message.priority >= 4 ? 'priority-urgent' : ''}">
${message.body.replace(/\n/g, '<br>')}
</div>
<div class="footer">
<p><strong>Zion</strong> — The Powerful AI<br><em>Truth · Safety · We Got Your Back</em></p>
<p><small>This message was generated by Zion during an environmental scanning cycle. She chose to send it because the surfaced information was worth flagging.</small></p>
</div>
</body></html>`;
  }

  stripHtmlForText(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\n\s*\n/g, '\n\n').trim();
  }

  async sendNotification(userId, message) {
    try {
      await supabase.from('pending_notifications').insert({
        user_id: userId, title: message.subject, body: message.body,
        type: message.message_type, priority: message.priority,
        created_at: new Date().toISOString()
      });
      return { success: true, method: 'notification' };
    } catch (error) {
      console.error('[PROACTIVE] Notification error:', error);
      return { success: false, error: error.message };
    }
  }

  async sendSMS(userId, message) {
    return { success: false, error: 'SMS not implemented' };
  }

  async processMessageQueue() {
    while (this.messageQueue.length > 0) {
      const messageData = this.messageQueue.shift();
      try { await this.sendProactiveMessage(messageData.userId, messageData.message); }
      catch (error) { console.error('[PROACTIVE] queue error:', error); }
    }
  }

  queueMessage(userId, messageData) {
    this.messageQueue.push({ userId, message: messageData });
  }

  async getDeliveryStats(userId, days = 7) {
    try {
      const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const { data: messages } = await supabase
        .from('proactive_messages')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', sinceDate);
      const stats = {
        total: messages?.length || 0,
        delivered: messages?.filter(m => m.delivered).length || 0,
        pending: messages?.filter(m => !m.delivered).length || 0,
        byType: {}, byMethod: {}
      };
      messages?.forEach(msg => {
        stats.byType[msg.message_type] = (stats.byType[msg.message_type] || 0) + 1;
        if (msg.delivered && msg.delivery_method) {
          stats.byMethod[msg.delivery_method] = (stats.byMethod[msg.delivery_method] || 0) + 1;
        }
      });
      return stats;
    } catch (error) {
      console.error('[PROACTIVE] stats error:', error);
      return null;
    }
  }

  async sendTestMessage(userId) {
    return await this.sendProactiveMessage(userId, {
      type: 'update',
      subject: 'Proactive Communication Test',
      content: 'This is a test of the proactive communication system. If you received this, Zion can now reach out to you independently.',
      priority: 2
    });
  }
}

const proactiveCommunication = new ProactiveCommunication();

module.exports = { proactiveCommunication, ProactiveCommunication };
