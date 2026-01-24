export async function sendSMS(mobileNumber: string, message: string) {
  const apiKey = process.env.FAST2SMS_API_KEY;

  if (!apiKey) {
    console.warn('FAST2SMS_API_KEY is not set. SMS will not be sent.');
    return { success: false, error: 'API key missing' };
  }

  try {
    const response = await fetch(`https://www.fast2sms.com/dev/bulkV2?authorization=${apiKey}&route=otp&variables_values=${message}&numbers=${mobileNumber}`);
    
    const data = await response.json();
    
    if (data.return) {
      return { success: true, data };
    } else {
      console.error('Fast2SMS Error:', data);
      return { success: false, error: data.message || 'Failed to send SMS' };
    }
  } catch (error) {
    console.error('SMS sending failed:', error);
    return { success: false, error: 'Internal error' };
  }
}
