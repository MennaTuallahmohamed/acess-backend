const BASE_URL = 'http://localhost:3000';

const CONFIG = {
  categories: {
    accessControlId: 1,
    gatesId: 2,
  },
  deviceTypes: {
    readerId: 2,
    morphoMdId: 4,
    argus60Id: 140,
  },
};

const readerP8 = {
  issue: {
    issueCode: 'P8',
    title: 'عدم دقة التوقيت أو خطأ في عرض الوقت على الشاشة',
    description: 'Incorrect timing or time display on screen',
    severity: 'MEDIUM',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.readerId,
  },
  solutions: [
    {
      solutionCode: 'S1-P8',
      title: 'التحقق من حالة اتصال الجهاز عبر برنامج Morpho',
      description: 'Check device connection status in Morpho software',
      stepOrder: 1,
      isRequired: true,
      status: 'ACTIVE',
    },
    {
      solutionCode: 'S2-P8',
      title: 'إيقاف تشغيل الجهاز وفصل الطاقة لمدة 10 دقائق ثم إعادة التشغيل',
      description: 'Power off for 10 minutes then restart',
      stepOrder: 2,
      isRequired: true,
      status: 'ACTIVE',
    },
    {
      solutionCode: 'S18-P8',
      title: 'اختبار اتصال القارئ عبر سويتش خارجي بعد ضبط الإعدادات',
      description: 'Test reader connection using external switch after configuration',
      stepOrder: 3,
      isRequired: true,
      status: 'ACTIVE',
    },
    {
      solutionCode: 'S19-P8',
      title: 'استبدال البطارية الداخلية',
      description: 'Replace internal battery',
      stepOrder: 4,
      isRequired: true,
      status: 'ACTIVE',
    },
  ],
};

const softwareIssues = [
  {
    issueCode: 'SWP1',
    title: 'تأخر في توقيت الجهاز لعدة ساعات',
    description: 'Device time delayed by several hours',
    severity: 'MEDIUM',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP2',
    title: 'الجهاز لا يقوم بتصدير سجلات الحضور (TnA)',
    description: 'Device does not export attendance logs',
    severity: 'HIGH',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP3',
    title: 'ملفات سجلات CSV المصدرة يدوياً غير آمنة',
    description: 'Exported CSV transaction logs are not secure',
    severity: 'MEDIUM',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP4',
    title: 'بطء شديد في النظام عند تنفيذ إجراءات على ملف تعريف يضم جميع الأجهزة',
    description: 'System is very slow when performing actions on a profile containing all devices',
    severity: 'HIGH',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP5',
    title: 'بعض المستخدمين ليس لديهم عمليات دخول/خروج.',
    description: 'Some users do not have check-in/check-out transactions',
    severity: 'MEDIUM',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP6',
    title: 'يقوم برنامج (MorphoManager) بتسجيل سجل معاملات لـ 11 يوماً فقط.',
    description: 'MorphoManager stores transaction log for only 11 days',
    severity: 'HIGH',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP7',
    title: 'موظفون لديهم سجلات في Morpho ولكنها لا تظهر في HITS',
    description: 'Employees have records in Morpho but not shown in HITS',
    severity: 'HIGH',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP8',
    title: 'نظام HITS لا يقرأ تسميات الأجهزة التي تحتوي على شرطة سفلية (_)',
    description: 'HITS does not read device labels containing underscore',
    severity: 'MEDIUM',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP9',
    title: 'تأخير لمدة ساعة في جميع السجلات بسبب اختلاف المنطقة الزمنية',
    description: 'One-hour delay in all records بسبب timezone mismatch',
    severity: 'MEDIUM',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP10',
    title: 'إضافة مستخدمين تلقائياً عند إنشاء ملف تعريف جديد للجهاز',
    description: 'Users are added automatically when creating a new device profile',
    severity: 'HIGH',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP11',
    title: 'تسجيل موظفين كمتأخرين في نوبات ليلية دون وجود فعلي',
    description: 'Employees marked late in night shifts without actual lateness',
    severity: 'HIGH',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP12',
    title: 'تأخر توقيت الخادم بمقدار 3 دقائق',
    description: 'Server time delayed by 3 minutes',
    severity: 'MEDIUM',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP13',
    title: 'تعطيل خاصية التصدير (Export) في 8 أجهزة',
    description: 'Export feature disabled in 8 devices',
    severity: 'HIGH',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP14',
    title: 'توحيد أسماء ملفات تعريف الأجهزة وملفات تعريف توزيع المستخدمين باللغة العربية.',
    description: 'Unify device profile names and user distribution profile names in Arabic',
    severity: 'LOW',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP15',
    title: 'عدم الاتساق في تسمية الأجهزة الناتج عن الإعدادات السابقة.',
    description: 'Inconsistent device naming caused by previous settings',
    severity: 'MEDIUM',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP16',
    title: 'نسخة قاعدة البيانات تالفة.',
    description: 'Database version is corrupted',
    severity: 'CRITICAL',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
  {
    issueCode: 'SWP17',
    title: 'أكثر من 1400 جهاز على نفس السيرفر.',
    description: 'More than 1400 devices on the same server',
    severity: 'CRITICAL',
    status: 'ACTIVE',
    categoryId: CONFIG.categories.accessControlId,
    deviceTypeId: CONFIG.deviceTypes.morphoMdId,
  },
];

const softwareSolutions = [
  { solutionCode: 'SWS1', issueCode: 'SWP1', title: 'تحديث إعدادات المنطقة الزمنية (Timezone) على جميع الأجهزة', description: 'Update timezone settings on all devices', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS2', issueCode: 'SWP2', title: 'التحقيق في مشكلة عدم التصدير وتفعيلها للأجهزة المعنية', description: 'Investigate export issue and enable it on affected devices', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS3', issueCode: 'SWP3', title: 'تفعيل خدمة المزامنة التلقائية مع نظام HITS لإيقاف التصدير اليدوي', description: 'Enable automatic sync with HITS instead of manual export', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS4', issueCode: 'SWP4', title: 'تقسيم الأجهزة إلى ملفات تعريف (Profiles) منفصلة لتقليل الحمل', description: 'Split devices into separate profiles to reduce load', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS5', issueCode: 'SWP5', title: 'تأكد من عدم استخدام المستخدمين لنفس الجهاز بشكل مستمر لتسجيل الدخول أو تسجيل الخروج.', description: 'Ensure users are not repeatedly using the same device for check-in/out', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS6', issueCode: 'SWP6', title: 'مراجعة وتحديد السعة القصوى للسجلات في قاعدة البيانات.', description: 'Review and define maximum transaction capacity in database', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS7', issueCode: 'SWP7', title: 'التحقق من صحة عملية تصدير/استيراد جدول سجل المعاملات (TransactionLog) مع نظام HITS.', description: 'Validate TransactionLog export/import process with HITS', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS8', issueCode: 'SWP8', title: 'تعديل تسمية الأجهزة لتنتهي بـ (-) بدلاً من (_) قبل كلمة IN/OUT', description: 'Replace underscore with hyphen before IN/OUT in device labels', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS9', issueCode: 'SWP9', title: 'ضبط ومطابقة توقيت الأجهزة مع توقيت قاعدة البيانات (UTC/Cairo)', description: 'Align device time with database time UTC/Cairo', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS10', issueCode: 'SWP10', title: 'التحقيق في سبب الإضافة التلقائية للمستخدمين في MorphoManager', description: 'Investigate automatic user addition in MorphoManager', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS11', issueCode: 'SWP11', title: 'no solution found yet', description: 'No solution found yet', stepOrder: 1, isRequired: false, status: 'INACTIVE' },
  { solutionCode: 'SWS12', issueCode: 'SWP12', title: 'no solution found yet', description: 'No solution found yet', stepOrder: 1, isRequired: false, status: 'INACTIVE' },
  { solutionCode: 'SWS13', issueCode: 'SWP13', title: 'تم إصلاح المشكلة عن طريق تفعيل خاصية التصدير (Export) في 8 أجهزة.', description: 'Issue fixed by enabling export in 8 devices', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS14', issueCode: 'SWP14', title: 'توحيد أسماء ملفات تعريف الأجهزة وملفات تعريف توزيع المستخدمين باللغة العربية.', description: 'Unify profile names in Arabic', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS15', issueCode: 'SWP15', title: 'تصحيح عدم الاتساق في تسمية الأجهزة الناتج عن الإعدادات السابقة.', description: 'Fix inconsistent device naming caused by previous settings', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS16', issueCode: 'SWP16', title: 'نقل قاعدة البيانات إلى نسخة مدفوعة.', description: 'Move database to paid version', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
  { solutionCode: 'SWS17', issueCode: 'SWP17', title: 'تقسيم السيرفر الرئيسي إلى عدة سيرفرات لتقليل الحمل عن السيرفر الرئيسي.', description: 'Split main server into multiple servers to reduce load', stepOrder: 1, isRequired: true, status: 'ACTIVE' },
];

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} -> ${JSON.stringify(data)}`);
  }

  return data;
}

async function getAllIssues() {
  return request('/issues');
}

async function findIssueByCode(issueCode) {
  const all = await getAllIssues();
  return all.find((item) => item.issueCode === issueCode) || null;
}

async function ensureIssue(issuePayload) {
  const existing = await findIssueByCode(issuePayload.issueCode);
  if (existing) {
    console.log(`Issue exists: ${issuePayload.issueCode} -> id ${existing.id}`);
    return existing;
  }

  const created = await request('/issues', {
    method: 'POST',
    body: JSON.stringify(issuePayload),
  });

  console.log(`Created issue: ${issuePayload.issueCode} -> id ${created.id}`);
  return created;
}

async function getSolutionsByIssue(issueId) {
  return request(`/issues/${issueId}/solutions`);
}

async function ensureSolution(issueId, solutionPayload) {
  const existingSolutions = await getSolutionsByIssue(issueId);
  const existing = existingSolutions.find(
    (item) => item.solutionCode === solutionPayload.solutionCode,
  );

  if (existing) {
    console.log(`Solution exists: ${solutionPayload.solutionCode} -> id ${existing.id}`);
    return existing;
  }

  const created = await request('/issues/solutions', {
    method: 'POST',
    body: JSON.stringify({
      ...solutionPayload,
      issueId,
    }),
  });

  console.log(`Created solution: ${solutionPayload.solutionCode} -> id ${created.id}`);
  return created;
}

async function importReaderP8() {
  const issue = await ensureIssue(readerP8.issue);

  for (const solution of readerP8.solutions) {
    await ensureSolution(issue.id, solution);
  }
}

async function importSoftware() {
  const issueMap = {};

  for (const issuePayload of softwareIssues) {
    const issue = await ensureIssue(issuePayload);
    issueMap[issue.issueCode] = issue;
  }

  for (const solutionPayload of softwareSolutions) {
    const issue = issueMap[solutionPayload.issueCode];
    if (!issue) {
      console.log(`Skipped solution ${solutionPayload.solutionCode}: missing issue ${solutionPayload.issueCode}`);
      continue;
    }

    const { issueCode, ...solution } = solutionPayload;
    await ensureSolution(issue.id, solution);
  }
}

async function main() {
  console.log('Starting import...');
  await importReaderP8();
  await importSoftware();
  console.log('Done successfully.');
}

main().catch((err) => {
  console.error('Import failed:', err.message);
  process.exit(1);
});