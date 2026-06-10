// Kiosk intake-form translations. Self-contained (no i18n library) — the kiosk
// is the only multilingual surface, so a typed dictionary keyed by locale is the
// lightest thing that works. Answers are stored under stable keys elsewhere; this
// only drives presentation. `consentText` is snapshotted onto each signed record
// in the guest's chosen language.
//
// NOTE: de / es / it / ja / ko consent + health wording is a best-effort draft —
// have a native speaker / legal review it before relying on it for liability.

export const KIOSK_LOCALES = ['en', 'zh-TW', 'ja', 'ko', 'de', 'es', 'it'] as const;
export type KioskLocale = (typeof KIOSK_LOCALES)[number];
export const DEFAULT_LOCALE: KioskLocale = 'en';

export const TEMPLATE_VERSION = 'v1';

// Stable, language-neutral health-question keys (also the jsonb keys stored).
export const HEALTH_KEYS = ['pregnant', 'cardiac', 'injury', 'skin', 'allergy'] as const;
export type HealthKey = (typeof HEALTH_KEYS)[number];

export interface KioskDict {
  nativeName: string;
  title: string;
  subtitle: string;
  // identity
  name: string;
  email: string;
  phone: string;
  age: string;
  nationality: string;
  hotel: string;
  gender: string;
  genderMale: string;
  genderFemale: string;
  genderOther: string;
  genderNa: string;
  service: string;
  servicePlaceholder: string;
  // pressure
  pressure: string;
  pressureSoft: string;
  pressureMedium: string;
  pressureHard: string;
  // health
  healthTitle: string;
  health: Record<HealthKey, string>;
  yes: string;
  no: string;
  healthNote: string;
  healthNotePlaceholder: string;
  // consent
  consentTitle: string;
  consentText: string;
  agree: string;
  // signature
  signatureTitle: string;
  signatureHint: string;
  clear: string;
  // misc
  optional: string;
  submit: string;
  submitting: string;
  // validation
  errName: string;
  errPressure: string;
  errSign: string;
  errAgree: string;
  // thank-you
  thankTitle: string;
  thankMsg: string;
  next: string;
}

export const KIOSK_DICTS: Record<KioskLocale, KioskDict> = {
  'zh-TW': {
    nativeName: '繁體中文',
    title: '健康問卷與同意書',
    subtitle: '請於開始服務前填寫以下資料',
    name: '姓名',
    email: '電子郵件',
    phone: '電話',
    age: '年齡',
    nationality: '國籍',
    hotel: '入住飯店',
    gender: '性別',
    genderMale: '男',
    genderFemale: '女',
    genderOther: '其他',
    genderNa: '不願透露',
    service: '想加強的部位',
    servicePlaceholder: '例如：肩頸、下背、腿部',
    pressure: '按摩力道',
    pressureSoft: '輕',
    pressureMedium: '中',
    pressureHard: '重',
    healthTitle: '健康聲明',
    health: {
      pregnant: '懷孕中或可能懷孕',
      cardiac: '心臟病、高血壓或血液循環問題',
      injury: '近期手術、骨折、扭傷或關節問題',
      skin: '皮膚疾病、傷口、發炎或感染',
      allergy: '對精油、乳液或特定成分過敏',
    },
    yes: '是',
    no: '否',
    healthNote: '如以上有任何一項為「是」，請說明狀況及任何需要避開或注意的部位',
    healthNotePlaceholder: '例如：左膝近期開刀，請避開該部位',
    consentTitle: '同意聲明',
    consentText:
      '本人聲明以上所填資訊屬實且完整。本人了解按摩／芳療服務的性質與可能之風險，並自願同意接受服務。對於未據實告知之健康狀況，概由本人自行負責。',
    agree: '我已閱讀並同意以上聲明',
    signatureTitle: '簽名',
    signatureHint: '請於下方簽名',
    clear: '清除',
    optional: '選填',
    submit: '送出',
    submitting: '送出中…',
    errName: '請填寫姓名',
    errPressure: '請選擇按摩力道',
    errSign: '請簽名',
    errAgree: '請勾選同意聲明',
    thankTitle: '已送出，謝謝您！',
    thankMsg: '請將平板交回櫃台人員。',
    next: '下一位',
  },
  en: {
    nativeName: 'English',
    title: 'Health Questionnaire & Consent',
    subtitle: 'Please complete the following before your service',
    name: 'Name',
    email: 'Email',
    phone: 'Phone',
    age: 'Age',
    nationality: 'Nationality',
    hotel: 'Hotel you are staying at',
    gender: 'Gender',
    genderMale: 'Male',
    genderFemale: 'Female',
    genderOther: 'Other',
    genderNa: 'Prefer not to say',
    service: 'Areas you would like us to focus on',
    servicePlaceholder: 'e.g. neck & shoulders, lower back, legs',
    pressure: 'Massage pressure',
    pressureSoft: 'Soft',
    pressureMedium: 'Medium',
    pressureHard: 'Hard',
    healthTitle: 'Health declaration',
    health: {
      pregnant: 'Pregnant or possibly pregnant',
      cardiac: 'Heart disease, high blood pressure, or circulation problems',
      injury: 'Recent surgery, fracture, sprain, or joint problems',
      skin: 'Skin disease, wound, inflammation, or infection',
      allergy: 'Allergy to oils, lotions, or specific ingredients',
    },
    yes: 'Yes',
    no: 'No',
    healthNote: 'If you answered “Yes” to any of the above, please describe your condition and any areas to avoid or be careful with',
    healthNotePlaceholder: 'e.g. recent knee surgery on left leg — please avoid that area',
    consentTitle: 'Consent',
    consentText:
      'I declare that the information above is true and complete. I understand the nature of the massage / spa service and its possible risks, and I voluntarily agree to receive the service. I accept responsibility for any health condition I have not disclosed.',
    agree: 'I have read and agree to the statement above',
    signatureTitle: 'Signature',
    signatureHint: 'Please sign below',
    clear: 'Clear',
    optional: 'optional',
    submit: 'Submit',
    submitting: 'Submitting…',
    errName: 'Please enter your name',
    errPressure: 'Please choose a massage pressure',
    errSign: 'Please sign',
    errAgree: 'Please agree to the consent statement',
    thankTitle: 'Submitted — thank you!',
    thankMsg: 'Please hand the tablet back to the front desk.',
    next: 'Next guest',
  },
  ja: {
    nativeName: '日本語',
    title: '健康に関する問診票・同意書',
    subtitle: '施術前に以下をご記入ください',
    name: 'お名前',
    email: 'メールアドレス',
    phone: '電話番号',
    age: '年齢',
    nationality: '国籍',
    hotel: 'ご宿泊のホテル',
    gender: '性別',
    genderMale: '男性',
    genderFemale: '女性',
    genderOther: 'その他',
    genderNa: '回答しない',
    service: '重点的にほぐしたい部位',
    servicePlaceholder: '例：首・肩、腰、脚',
    pressure: 'マッサージの強さ',
    pressureSoft: '弱め',
    pressureMedium: '普通',
    pressureHard: '強め',
    healthTitle: '健康状態の申告',
    health: {
      pregnant: '妊娠中または妊娠の可能性がある',
      cardiac: '心臓病、高血圧、血行障害がある',
      injury: '最近の手術、骨折、捻挫、関節の問題がある',
      skin: '皮膚疾患、傷、炎症、感染がある',
      allergy: 'オイル・ローション・特定成分にアレルギーがある',
    },
    yes: 'はい',
    no: 'いいえ',
    healthNote: '上記で「はい」がある場合は、状況と避けるべき・注意すべき部位をご記入ください',
    healthNotePlaceholder: '例：左膝を最近手術したため、その部位は避けてください',
    consentTitle: '同意事項',
    consentText:
      '上記の記入内容が真実かつ完全であることを申告します。マッサージ・スパ施術の性質および起こりうるリスクを理解し、自らの意思で施術を受けることに同意します。申告しなかった健康状態については自己の責任とします。',
    agree: '上記の内容を読み、同意します',
    signatureTitle: '署名',
    signatureHint: '下の枠内にご署名ください',
    clear: '消去',
    optional: '任意',
    submit: '送信',
    submitting: '送信中…',
    errName: 'お名前をご記入ください',
    errPressure: 'マッサージの強さを選んでください',
    errSign: 'ご署名ください',
    errAgree: '同意事項にチェックしてください',
    thankTitle: '送信しました。ありがとうございます！',
    thankMsg: 'タブレットを受付にお返しください。',
    next: '次のお客様',
  },
  ko: {
    nativeName: '한국어',
    title: '건강 문진표 및 동의서',
    subtitle: '서비스 전 아래 내용을 작성해 주세요',
    name: '이름',
    email: '이메일',
    phone: '전화번호',
    age: '나이',
    nationality: '국적',
    hotel: '숙박 호텔',
    gender: '성별',
    genderMale: '남성',
    genderFemale: '여성',
    genderOther: '기타',
    genderNa: '응답하지 않음',
    service: '집중적으로 받고 싶은 부위',
    servicePlaceholder: '예: 목·어깨, 허리, 다리',
    pressure: '마사지 강도',
    pressureSoft: '약하게',
    pressureMedium: '보통',
    pressureHard: '강하게',
    healthTitle: '건강 상태 신고',
    health: {
      pregnant: '임신 중이거나 임신 가능성이 있음',
      cardiac: '심장질환, 고혈압 또는 혈액순환 문제',
      injury: '최근 수술, 골절, 염좌 또는 관절 문제',
      skin: '피부 질환, 상처, 염증 또는 감염',
      allergy: '오일, 로션 또는 특정 성분에 알레르기',
    },
    yes: '예',
    no: '아니오',
    healthNote: '위 항목 중 “예”가 있으면 상태와 피하거나 주의해야 할 부위를 설명해 주세요',
    healthNotePlaceholder: '예: 최근 왼쪽 무릎 수술 — 해당 부위를 피해 주세요',
    consentTitle: '동의 사항',
    consentText:
      '본인은 위 기재 내용이 사실이며 빠짐없음을 확인합니다. 마사지·스파 서비스의 성격과 발생 가능한 위험을 이해하며, 자발적으로 서비스를 받는 데 동의합니다. 신고하지 않은 건강 상태에 대해서는 본인이 책임집니다.',
    agree: '위 내용을 읽고 동의합니다',
    signatureTitle: '서명',
    signatureHint: '아래에 서명해 주세요',
    clear: '지우기',
    optional: '선택',
    submit: '제출',
    submitting: '제출 중…',
    errName: '이름을 입력해 주세요',
    errPressure: '마사지 강도를 선택해 주세요',
    errSign: '서명해 주세요',
    errAgree: '동의 사항에 체크해 주세요',
    thankTitle: '제출되었습니다. 감사합니다!',
    thankMsg: '태블릿을 프런트에 돌려주세요.',
    next: '다음 고객',
  },
  de: {
    nativeName: 'Deutsch',
    title: 'Gesundheitsfragebogen & Einwilligung',
    subtitle: 'Bitte vor der Behandlung ausfüllen',
    name: 'Name',
    email: 'E-Mail',
    phone: 'Telefon',
    age: 'Alter',
    nationality: 'Nationalität',
    hotel: 'Ihr Hotel',
    gender: 'Geschlecht',
    genderMale: 'Männlich',
    genderFemale: 'Weiblich',
    genderOther: 'Divers',
    genderNa: 'Keine Angabe',
    service: 'Bereiche, die wir besonders behandeln sollen',
    servicePlaceholder: 'z. B. Nacken & Schultern, unterer Rücken, Beine',
    pressure: 'Massagedruck',
    pressureSoft: 'Sanft',
    pressureMedium: 'Mittel',
    pressureHard: 'Kräftig',
    healthTitle: 'Gesundheitserklärung',
    health: {
      pregnant: 'Schwanger oder möglicherweise schwanger',
      cardiac: 'Herzkrankheit, Bluthochdruck oder Durchblutungsstörungen',
      injury: 'Kürzliche Operation, Fraktur, Verstauchung oder Gelenkprobleme',
      skin: 'Hautkrankheit, Wunde, Entzündung oder Infektion',
      allergy: 'Allergie gegen Öle, Lotionen oder bestimmte Inhaltsstoffe',
    },
    yes: 'Ja',
    no: 'Nein',
    healthNote: 'Wenn Sie eine der obigen Fragen mit „Ja” beantwortet haben, beschreiben Sie bitte Ihren Zustand und Bereiche, die vermieden werden sollten',
    healthNotePlaceholder: 'z. B. kürzliche Knie-OP links — bitte diesen Bereich meiden',
    consentTitle: 'Einwilligung',
    consentText:
      'Ich erkläre, dass die obigen Angaben wahr und vollständig sind. Ich verstehe die Art der Massage-/Spa-Behandlung und ihre möglichen Risiken und stimme der Behandlung freiwillig zu. Für nicht angegebene gesundheitliche Beschwerden übernehme ich die Verantwortung.',
    agree: 'Ich habe die obige Erklärung gelesen und stimme ihr zu',
    signatureTitle: 'Unterschrift',
    signatureHint: 'Bitte unten unterschreiben',
    clear: 'Löschen',
    optional: 'optional',
    submit: 'Absenden',
    submitting: 'Wird gesendet…',
    errName: 'Bitte geben Sie Ihren Namen ein',
    errPressure: 'Bitte wählen Sie den Massagedruck',
    errSign: 'Bitte unterschreiben',
    errAgree: 'Bitte stimmen Sie der Einwilligung zu',
    thankTitle: 'Gesendet — vielen Dank!',
    thankMsg: 'Bitte geben Sie das Tablet an der Rezeption zurück.',
    next: 'Nächster Gast',
  },
  es: {
    nativeName: 'Español',
    title: 'Cuestionario de salud y consentimiento',
    subtitle: 'Por favor, complete lo siguiente antes de su servicio',
    name: 'Nombre',
    email: 'Correo electrónico',
    phone: 'Teléfono',
    age: 'Edad',
    nationality: 'Nacionalidad',
    hotel: 'Hotel donde se hospeda',
    gender: 'Género',
    genderMale: 'Hombre',
    genderFemale: 'Mujer',
    genderOther: 'Otro',
    genderNa: 'Prefiero no decirlo',
    service: 'Zonas en las que enfocarnos',
    servicePlaceholder: 'p. ej. cuello y hombros, zona lumbar, piernas',
    pressure: 'Presión del masaje',
    pressureSoft: 'Suave',
    pressureMedium: 'Media',
    pressureHard: 'Fuerte',
    healthTitle: 'Declaración de salud',
    health: {
      pregnant: 'Embarazada o posiblemente embarazada',
      cardiac: 'Enfermedad cardíaca, hipertensión o problemas de circulación',
      injury: 'Cirugía reciente, fractura, esguince o problemas articulares',
      skin: 'Enfermedad de la piel, herida, inflamación o infección',
      allergy: 'Alergia a aceites, lociones o ingredientes específicos',
    },
    yes: 'Sí',
    no: 'No',
    healthNote: 'Si respondió “Sí” a alguna de las anteriores, describa su condición y las zonas a evitar o tener precaución',
    healthNotePlaceholder: 'p. ej. cirugía reciente en rodilla izquierda — evitar esa zona',
    consentTitle: 'Consentimiento',
    consentText:
      'Declaro que la información anterior es verdadera y completa. Entiendo la naturaleza del servicio de masaje / spa y sus posibles riesgos, y acepto voluntariamente recibir el servicio. Asumo la responsabilidad por cualquier condición de salud que no haya declarado.',
    agree: 'He leído y acepto la declaración anterior',
    signatureTitle: 'Firma',
    signatureHint: 'Por favor firme abajo',
    clear: 'Borrar',
    optional: 'opcional',
    submit: 'Enviar',
    submitting: 'Enviando…',
    errName: 'Por favor ingrese su nombre',
    errPressure: 'Por favor elija la presión del masaje',
    errSign: 'Por favor firme',
    errAgree: 'Por favor acepte el consentimiento',
    thankTitle: 'Enviado — ¡gracias!',
    thankMsg: 'Por favor devuelva la tableta a recepción.',
    next: 'Siguiente cliente',
  },
  it: {
    nativeName: 'Italiano',
    title: 'Questionario sanitario e consenso',
    subtitle: 'Si prega di compilare quanto segue prima del servizio',
    name: 'Nome',
    email: 'Email',
    phone: 'Telefono',
    age: 'Età',
    nationality: 'Nazionalità',
    hotel: 'Hotel dove alloggi',
    gender: 'Genere',
    genderMale: 'Uomo',
    genderFemale: 'Donna',
    genderOther: 'Altro',
    genderNa: 'Preferisco non dirlo',
    service: 'Zone su cui concentrarsi',
    servicePlaceholder: 'es. collo e spalle, zona lombare, gambe',
    pressure: 'Pressione del massaggio',
    pressureSoft: 'Leggera',
    pressureMedium: 'Media',
    pressureHard: 'Forte',
    healthTitle: 'Dichiarazione sanitaria',
    health: {
      pregnant: 'In gravidanza o possibile gravidanza',
      cardiac: 'Malattie cardiache, ipertensione o problemi di circolazione',
      injury: 'Intervento recente, frattura, distorsione o problemi articolari',
      skin: 'Malattia della pelle, ferita, infiammazione o infezione',
      allergy: 'Allergia a oli, lozioni o ingredienti specifici',
    },
    yes: 'Sì',
    no: 'No',
    healthNote: 'Se hai risposto “Sì” a una delle precedenti, descrivi la tua condizione e le zone da evitare o trattare con cautela',
    healthNotePlaceholder: 'es. recente intervento al ginocchio sinistro — evitare quella zona',
    consentTitle: 'Consenso',
    consentText:
      'Dichiaro che le informazioni sopra riportate sono veritiere e complete. Comprendo la natura del servizio di massaggio / spa e i suoi possibili rischi e accetto volontariamente di ricevere il servizio. Mi assumo la responsabilità per qualsiasi condizione di salute non dichiarata.',
    agree: 'Ho letto e accetto la dichiarazione sopra',
    signatureTitle: 'Firma',
    signatureHint: 'Si prega di firmare qui sotto',
    clear: 'Cancella',
    optional: 'facoltativo',
    submit: 'Invia',
    submitting: 'Invio…',
    errName: 'Inserisci il tuo nome',
    errPressure: 'Scegli la pressione del massaggio',
    errSign: 'Per favore firma',
    errAgree: 'Accetta il consenso',
    thankTitle: 'Inviato — grazie!',
    thankMsg: 'Riconsegna il tablet alla reception.',
    next: 'Prossimo ospite',
  },
};
