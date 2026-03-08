// Email Service for PromptCache
// Uses Resend API (free tier: 3,000 emails/month)

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = 'PromptCache <noreply@promptcache.dev>';
const FROM_NAME = 'PromptCache';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    console.log('[Email] Resend API key not configured. Email would be:', options);
    return { success: true }; // Dev mode: just log
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text || options.html.replace(/<[^>]*>/g, '')
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return { success: false, error };
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

// ============================================
// Email Templates
// ============================================

export function sendVerificationEmail(email: string, token: string): Promise<{ success: boolean; error?: string }> {
  const verifyUrl = `https://prompt-cache-three.vercel.app/verify?token=${token}&email=${encodeURIComponent(email)}`;
  
  return sendEmail({
    to: email,
    subject: 'Verify your PromptCache account',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #030307; color: #f8fafc; padding: 2rem;">
  <div style="max-width: 500px; margin: 0 auto; background: #12121a; border-radius: 12px; padding: 2rem;">
    <h1 style="color: #6366f1; margin-bottom: 1rem;">🎯 Verify Your Email</h1>
    <p style="color: #94a3b8; margin-bottom: 1.5rem;">Thanks for signing up for PromptCache! Click the button below to verify your email address.</p>
    
    <a href="${verifyUrl}" style="display: inline-block; background: #6366f1; color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin-bottom: 1.5rem;">Verify Email</a>
    
    <p style="color: #64748b; font-size: 0.875rem;">Or copy this link: ${verifyUrl}</p>
    
    <hr style="border: none; border-top: 1px solid #333; margin: 1.5rem 0;">
    
    <p style="color: #64748b; font-size: 0.75rem;">If you didn't create an account, you can safely ignore this email.</p>
  </div>
</body>
</html>
    `
  });
}

export function sendWelcomeEmail(email: string, name?: string): Promise<{ success: boolean; error?: string }> {
  return sendEmail({
    to: email,
    subject: 'Welcome to PromptCache! 🚀',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #030307; color: #f8fafc; padding: 2rem;">
  <div style="max-width: 500px; margin: 0 auto; background: #12121a; border-radius: 12px; padding: 2rem;">
    <h1 style="color: #6366f1;">🎯 Welcome to PromptCache!</h1>
    
    <p style="color: #94a3b8; margin: 1rem 0;">Hi${name ? ` ${name}` : ''},</p>
    
    <p style="color: #94a3b8;">You're now part of the future of AI cost savings! Here's what you can do:</p>
    
    <ul style="color: #94a3b8; margin: 1rem 0; padding-left: 1.5rem;">
      <li style="margin-bottom: 0.5rem;">📦 <strong>Cache your LLM responses</strong> - Save up to 90% on API costs</li>
      <li style="margin-bottom: 0.5rem;">🔍 <strong>Semantic search</strong> - Find similar prompts automatically</li>
      <li style="margin-bottom: 0.5rem;">📊 <strong>Analytics dashboard</strong> - See your savings in real-time</li>
    </ul>
    
    <a href="https://prompt-cache-three.vercel.app" style="display: inline-block; background: #6366f1; color: white; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 1rem 0;">Get Started →</a>
    
    <p style="color: #64748b; font-size: 0.875rem; margin-top: 2rem;">Questions? Reply to this email - we're here to help!</p>
    
    <p style="color: #6366f1; font-weight: 600;">- The PromptCache Team</p>
  </div>
</body>
</html>
    `
  });
}

export function sendPasswordResetEmail(email: string, token: string): Promise<{ success: boolean; error?: string }> {
  const resetUrl = `https://prompt-cache-three.vercel.app/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
  
  return sendEmail({
    to: email,
    subject: 'Reset your PromptCache password',
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #030307; color: #f8fafc; padding: 2rem;">
  <div style="max-width: 500px; margin: 0 auto; background: #12121a; border-radius: 12px; padding: 2rem;">
    <h1 style="color: #f59e0b;">🔐 Reset Password</h1>
    <p style="color: #94a3b8; margin: 1rem 0;">You requested to reset your password. Click the button below:</p>
    
    <a href="${resetUrl}" style="display: inline-block; background: #f59e0b; color: #030307; padding: 0.75rem 1.5rem; border-radius: 8px; text-decoration: none; font-weight: 600; margin: 1rem 0;">Reset Password →</a>
    
    <p style="color: #64748b; font-size: 0.875rem;">This link expires in 1 hour.</p>
    
    <hr style="border: none; border-top: 1px solid #333; margin: 1.5rem 0;">
    
    <p style="color: #64748b; font-size: 0.75rem;">If you didn't request this, ignore this email.</p>
  </div>
</body>
</html>
    `
  });
}

export function sendAPIKeyCreatedEmail(email: string, keyName: string): Promise<{ success: boolean; error?: string }> {
  return sendEmail({
    to: email,
    subject: 'New API Key Created',
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #030307; color: #f8fafc; padding: 2rem;">
  <div style="max-width: 500px; margin: 0 auto; background: #12121a; border-radius: 12px; padding: 2rem;">
    <h1 style="color: #10b981;">🔑 New API Key Created</h1>
    <p style="color: #94a3b8; margin: 1rem 0;">A new API key "${keyName}" was just created for your account.</p>
    <p style="color: #64748b; font-size: 0.875rem;">If this wasn't you, please reset your password immediately.</p>
  </div>
</body>
</html>
    `
  });
}
