// ملف: /api/send-order.js
// Vercel Serverless Function لإرسال طلبات تليجرام بشكل آمن

export default async function handler(req, res) {
  // 1. التحقق من أن الطريقة POST فقط
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false,
      error: 'Method not allowed. Use POST only.',
      code: 'METHOD_NOT_ALLOWED'
    });
  }

  try {
    // 2. استلام البيانات من الموقع
    const { 
      productName, 
      productPrice, 
      name, 
      phone, 
      address, 
      quantity, 
      notes = '',
      pageUrl,
      timestamp
    } = req.body;

    // 3. التحقق من البيانات الأساسية
    const requiredFields = ['productName', 'name', 'phone', 'address', 'quantity'];
    const missingFields = requiredFields.filter(field => !req.body[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: `Missing required fields: ${missingFields.join(', ')}`,
        code: 'MISSING_FIELDS',
        missingFields
      });
    }

    // 4. التحقق من صحة البيانات
    if (!phone.match(/^[0-9\s\-\+\(\)]{8,20}$/)) {
      return res.status(400).json({ 
        success: false,
        error: 'Invalid phone number format',
        code: 'INVALID_PHONE'
      });
    }

    if (quantity < 1) {
      return res.status(400).json({ 
        success: false,
        error: 'Quantity must be at least 1',
        code: 'INVALID_QUANTITY'
      });
    }

    // 5. الحصول على التوكن و Chat ID من بيئة Vercel (آمن)
    const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    // 6. التحقق من وجود التوكن
    if (!BOT_TOKEN || !CHAT_ID) {
      console.error('❌ Telegram credentials missing in environment variables');
      console.error(`BOT_TOKEN exists: ${!!BOT_TOKEN}, CHAT_ID exists: ${!!CHAT_ID}`);
      
      return res.status(500).json({ 
        success: false,
        error: 'Server configuration error. Please contact support.',
        code: 'SERVER_CONFIG_ERROR'
      });
    }

    // 7. تنسيق الرسالة بشكل جميل
    const orderTime = timestamp || new Date().toLocaleString('ar-EG', {
      timeZone: 'Africa/Cairo',
      hour12: true,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const messageText = `
🛒 *طلب جديد من Capslank!*

📦 *المنتج:* ${productName}
💰 *السعر:* ${productPrice}
🔢 *الكمية:* ${quantity}

👤 *العميل:* ${name}
📞 *الهاتف:* \`${phone}\`
📍 *العنوان:* ${address}

${notes ? `📝 *ملاحظات:*\n${notes}\n` : ''}

🌐 *رابط الصفحة:* ${pageUrl || 'غير محدد'}
⏰ *التاريخ:* ${orderTime}

🆔 *معرف الطلب:* ${Date.now()}
    `.trim();

    // 8. إرسال الرسالة إلى تليجرام
    const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    
    console.log('📤 Sending to Telegram API...');
    console.log(`📱 Chat ID: ${CHAT_ID.substring(0, 5)}...`);
    
    const telegramResponse = await fetch(telegramUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: messageText,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        disable_notification: false
      }),
      timeout: 10000 // 10 ثواني timeout
    });

    const telegramResult = await telegramResponse.json();
    
    console.log('📩 Telegram API Response:', {
      ok: telegramResult.ok,
      description: telegramResult.description,
      messageId: telegramResult.result?.message_id
    });

    // 9. التحقق من استجابة تليجرام
    if (!telegramResult.ok) {
      console.error('❌ Telegram API Error:', telegramResult);
      
      let userErrorMessage = 'فشل إرسال الإشعار إلى التليجرام';
      let errorCode = 'TELEGRAM_API_ERROR';
      
      // تحسين رسالة الخطأ للمستخدم
      if (telegramResult.description?.includes('chat not found')) {
        userErrorMessage = 'خطأ في إعدادات الخادم. الرجاء التواصل مع الدعم.';
        errorCode = 'CHAT_NOT_FOUND';
      } else if (telegramResult.description?.includes('bot was blocked')) {
        userErrorMessage = 'البوت محظور. الرجاء التحقق من إعدادات التليجرام.';
        errorCode = 'BOT_BLOCKED';
      } else if (telegramResult.description?.includes('invalid token')) {
        userErrorMessage = 'رمز البوت غير صالح. الرجاء التحقق من الإعدادات.';
        errorCode = 'INVALID_TOKEN';
      }
      
      return res.status(500).json({
        success: false,
        error: userErrorMessage,
        code: errorCode,
        telegramError: telegramResult.description
      });
    }

    // 10. ✅ النجاح - إرسال إشعار تأكيد إضافي (اختياري)
    try {
      const confirmMessage = `✅ تم استلام طلب جديد من ${name} (${phone})\n📦 المنتج: ${productName}\n🆔 معرف: ${Date.now()}`;
      
      await fetch(telegramUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: confirmMessage,
          parse_mode: 'Markdown',
          disable_notification: false,
          reply_to_message_id: telegramResult.result.message_id
        })
      });
      
      console.log('✅ Confirmation message sent');
    } catch (confirmError) {
      console.warn('⚠️ Could not send confirmation:', confirmError.message);
      // لا نعيد خطأ لأن الطلب الأساسي نجح
    }

    // 11. تسجيل النجاح في logs (اختياري للتتبع)
    console.log('📊 Order Summary:', {
      product: productName,
      customer: name,
      phone: phone,
      quantity: quantity,
      time: new Date().toISOString(),
      messageId: telegramResult.result.message_id
    });

    // 12. الرد النهائي للعميل
    return res.status(200).json({ 
      success: true,
      message: 'تم إرسال طلبك بنجاح',
      message_id: telegramResult.result.message_id,
      timestamp: new Date().toISOString(),
      order_summary: {
        product: productName,
        customer: name,
        quantity: quantity
      }
    });

  } catch (error) {
    // 13. معالجة الأخطاء العامة
    console.error('🔥 Server Error Details:', {
      name: error.name,
      message: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    
    // تصنيف الأخطاء
    let statusCode = 500;
    let errorCode = 'INTERNAL_SERVER_ERROR';
    let errorMessage = 'حدث خطأ غير متوقع في الخادم';
    
    if (error.name === 'FetchError' || error.message.includes('fetch')) {
      statusCode = 502;
      errorCode = 'NETWORK_ERROR';
      errorMessage = 'خطأ في الاتصال بخدمة التليجرام. الرجاء المحاولة لاحقاً.';
    } else if (error.name === 'TimeoutError') {
      statusCode = 504;
      errorCode = 'TIMEOUT_ERROR';
      errorMessage = 'انتهت مهلة الاتصال. الرجاء المحاولة مرة أخرى.';
    }
    
    return res.status(statusCode).json({ 
      success: false,
      error: errorMessage,
      code: errorCode,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

// إعدادات إضافية للدالة
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb' // الحد الأقصى لحجم البيانات
    },
    // تحسين الأداء
    responseLimit: false,
    // إعدادات CORS
    externalResolver: true
  }
};

// دالة مساعدة لتسجيل الطلبات (اختياري)
function logOrderToConsole(orderData) {
  const logEntry = {
    type: 'ORDER_SUBMITTED',
    timestamp: new Date().toISOString(),
    data: {
      product: orderData.productName,
      customer: orderData.name,
      phone: orderData.phone,
      quantity: orderData.quantity,
      ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent']
    }
  };
  
  console.log('📝 Order Log:', JSON.stringify(logEntry, null, 2));
}