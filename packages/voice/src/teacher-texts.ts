/** Teacher reply texts shared by the gateway (M0 scripted answers) and the bench. */
export const TEACHER_TEXTS = {
  en: {
    greeting:
      "Hello! I am your targeted learning teacher. Ask me anything about today's lesson, and I will explain it step by step.",
    photosynthesis:
      "Great question! Photosynthesis is how plants turn sunlight into food. Chlorophyll in the leaves captures light energy, and the plant uses it to convert carbon dioxide and water into glucose and oxygen. The overall equation is 6CO2 plus 6H2O, producing glucose and O2. Would you like to see the animated diagram?",
    fallback:
      "Let me walk you through that. The key idea in this lesson is the process we just saw in the video: energy from light is captured and stored as chemical energy in glucose. Try to connect each step to what you observed on screen.",
  },
  ar: {
    greeting:
      "مرحباً! أنا معلمك في التعلم الموجّه. اسألني أي شيء عن درس اليوم، وسأشرحه لك خطوة بخطوة.",
    photosynthesis:
      "سؤال ممتاز! البناء الضوئي هو كيفية تحويل النبات لأشعة الشمس إلى غذاء. يلتقط الكلوروفيل في الأوراق الطاقة الضوئية، ثم يحوّل النبات ثاني أكسيد الكربون والماء إلى جلوكوز وأكسجين. هل تريد مشاهدة الرسم التوضيحي المتحرك؟",
    fallback:
      "دعني أشرح لك ذلك. الفكرة الأساسية في هذا الدرس هي العملية التي شاهدناها في الفيديو: الطاقة الضوئية تُلتقط وتُخزَّن كطاقة كيميائية في الجلوكوز. حاول ربط كل خطوة بما لاحظته على الشاشة.",
  },
} as const;
