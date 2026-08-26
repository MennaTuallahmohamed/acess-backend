const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('');
  console.log('======================================================');
  console.log('              ALL USERS WITH DATABASE ROLES');
  console.log('======================================================');
  console.log('');

  // ==================================================
  // 1) جلب كل المستخدمين مع الـ Role الحقيقي
  // ==================================================
  const users = await prisma.user.findMany({
    include: {
      role: true,
    },
    orderBy: {
      id: 'asc',
    },
  });

  if (users.length === 0) {
    console.log('No users found.');
    return;
  }

  // ==================================================
  // 2) عرض كل المستخدمين
  // ==================================================
  console.log(`TOTAL USERS => ${users.length}`);
  console.log('');

  console.table(
    users.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      jobTitle: user.jobTitle,
      roleId: user.roleId,
      role: user.role?.name ?? 'NO ROLE',
      isActive: user.isActive,
      status: user.status,
    }))
  );

  // ==================================================
  // 3) إحصائية حسب الـ Role
  // ==================================================
  const roleCounts = {};

  for (const user of users) {
    const roleName = user.role?.name ?? 'NO ROLE';

    if (!roleCounts[roleName]) {
      roleCounts[roleName] = 0;
    }

    roleCounts[roleName]++;
  }

  console.log('');
  console.log('======================================================');
  console.log('                    ROLE SUMMARY');
  console.log('======================================================');
  console.log('');

  console.table(
    Object.entries(roleCounts).map(([role, count]) => ({
      role,
      count,
    }))
  );

  // ==================================================
  // 4) البحث عن ناس الـ jobTitle بتاعهم TECHNICIAN
  //    لكن الـ ROLE الحقيقية مش TECHNICIAN
  // ==================================================
  const suspiciousUsers = users.filter((user) => {
    const jobTitle = String(user.jobTitle ?? '')
      .trim()
      .toUpperCase();

    const role = String(user.role?.name ?? '')
      .trim()
      .toUpperCase();

    return (
      jobTitle === 'TECHNICIAN' &&
      role !== 'TECHNICIAN'
    );
  });

  console.log('');
  console.log('======================================================');
  console.log('  POSSIBLE ROLE BUGS');
  console.log('  jobTitle = TECHNICIAN BUT role != TECHNICIAN');
  console.log('======================================================');
  console.log('');

  if (suspiciousUsers.length === 0) {
    console.log('OK => No suspicious technician roles found.');
  } else {
    console.log(
      `WARNING => ${suspiciousUsers.length} USER(S) MAY HAVE WRONG ROLE`
    );

    console.table(
      suspiciousUsers.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        username: user.username,
        jobTitle: user.jobTitle,
        roleId: user.roleId,
        actualRole: user.role?.name ?? 'NO ROLE',
        isActive: user.isActive,
        status: user.status,
      }))
    );
  }

  // ==================================================
  // 5) عرض الفنيين فقط
  // ==================================================
  const technicians = users.filter((user) => {
    return (
      String(user.role?.name ?? '')
        .trim()
        .toUpperCase() === 'TECHNICIAN'
    );
  });

  console.log('');
  console.log('======================================================');
  console.log('                 TECHNICIANS ONLY');
  console.log('======================================================');
  console.log('');

  console.log(`TOTAL TECHNICIANS => ${technicians.length}`);

  console.table(
    technicians.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      jobTitle: user.jobTitle,
      roleId: user.roleId,
      role: user.role?.name,
      isActive: user.isActive,
      status: user.status,
    }))
  );

  // ==================================================
  // 6) عرض الـ Viewers فقط
  // ==================================================
  const viewers = users.filter((user) => {
    return (
      String(user.role?.name ?? '')
        .trim()
        .toUpperCase() === 'VIEWER'
    );
  });

  console.log('');
  console.log('======================================================');
  console.log('                    VIEWERS ONLY');
  console.log('======================================================');
  console.log('');

  console.log(`TOTAL VIEWERS => ${viewers.length}`);

  console.table(
    viewers.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      jobTitle: user.jobTitle,
      roleId: user.roleId,
      role: user.role?.name,
      isActive: user.isActive,
      status: user.status,
    }))
  );

  // ==================================================
  // 7) عرض الـ Admins فقط
  // ==================================================
  const admins = users.filter((user) => {
    return (
      String(user.role?.name ?? '')
        .trim()
        .toUpperCase() === 'ADMIN'
    );
  });

  console.log('');
  console.log('======================================================');
  console.log('                     ADMINS ONLY');
  console.log('======================================================');
  console.log('');

  console.log(`TOTAL ADMINS => ${admins.length}`);

  console.table(
    admins.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      jobTitle: user.jobTitle,
      roleId: user.roleId,
      role: user.role?.name,
      isActive: user.isActive,
      status: user.status,
    }))
  );

  console.log('');
  console.log('======================================================');
  console.log('                    FINISHED');
  console.log('======================================================');
  console.log('');
  console.log('READ ONLY => NO DATABASE DATA WAS CHANGED.');
  console.log('');
}

main()
  .catch((error) => {
    console.error('');
    console.error('ERROR:');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });