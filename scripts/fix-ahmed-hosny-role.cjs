const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

const idArg = process.argv.find((x) => x.startsWith('--id='));
const USER_ID = idArg ? Number(idArg.split('=')[1]) : null;

function normalize(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

function userText(user) {
  return [
    user.fullName,
    user.firstName,
    user.lastName,
    user.username,
    user.email,
    user.jobTitle,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

async function main() {
  console.log('');
  console.log('==============================================');
  console.log(' CHECK / FIX AHMED HOSNY ROLE');
  console.log('==============================================');
  console.log('');

  // -------------------------------------------
  // 1) عرض كل الـ Roles الموجودة
  // -------------------------------------------
  const roles = await prisma.role.findMany({
    orderBy: {
      id: 'asc',
    },
  });

  console.log('AVAILABLE ROLES:');

  console.table(
    roles.map((r) => ({
      id: r.id,
      name: r.name,
    }))
  );

  // -------------------------------------------
  // 2) العثور على Role الفني
  // -------------------------------------------
  const technicianRole = roles.find((role) => {
    const name = normalize(role.name);

    return (
      name === 'technician' ||
      name === 'tech' ||
      name === 'فني'
    );
  });

  if (!technicianRole) {
    console.error('');
    console.error('ERROR: TECHNICIAN role was not found.');
    console.error('No database changes were made.');
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log(
    `TECHNICIAN ROLE FOUND => id=${technicianRole.id}, name=${technicianRole.name}`
  );

  // -------------------------------------------
  // 3) لو ID متحدد نجيب المستخدم مباشرة
  // -------------------------------------------
  let targetUser = null;

  if (USER_ID) {
    targetUser = await prisma.user.findUnique({
      where: {
        id: USER_ID,
      },
      include: {
        role: true,
      },
    });

    if (!targetUser) {
      console.error('');
      console.error(`ERROR: User ID ${USER_ID} not found.`);
      console.error('No database changes were made.');
      process.exitCode = 1;
      return;
    }
  } else {
    // -------------------------------------------
    // 4) البحث عن Ahmed Hosny
    // -------------------------------------------
    const possibleUsers = await prisma.user.findMany({
      where: {
        OR: [
          {
            fullName: {
              contains: 'Ahmed',
              mode: 'insensitive',
            },
          },
          {
            firstName: {
              contains: 'Ahmed',
              mode: 'insensitive',
            },
          },
          {
            username: {
              contains: 'ahmed',
              mode: 'insensitive',
            },
          },
          {
            email: {
              contains: 'ahmed',
              mode: 'insensitive',
            },
          },
        ],
      },
      include: {
        role: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    console.log('');
    console.log('AHMED CANDIDATES:');

    console.table(
      possibleUsers.map((u) => ({
        id: u.id,
        fullName: u.fullName,
        firstName: u.firstName,
        lastName: u.lastName,
        username: u.username,
        email: u.email,
        jobTitle: u.jobTitle,
        roleId: u.roleId,
        role: u.role?.name,
        isActive: u.isActive,
        status: u.status,
      }))
    );

    const ahmedHosnyMatches = possibleUsers.filter((user) => {
      const text = userText(user);

      const hasAhmed =
        text.includes('ahmed') ||
        text.includes('أحمد') ||
        text.includes('احمد');

      const hasHosny =
        text.includes('hosny') ||
        text.includes('hosni') ||
        text.includes('حسني') ||
        text.includes('حسنى');

      return hasAhmed && hasHosny;
    });

    if (ahmedHosnyMatches.length === 0) {
      console.error('');
      console.error('Ahmed Hosny exact match was not found.');
      console.error('');
      console.error(
        'Look at the table above and run again using:'
      );
      console.error(
        'node scripts/fix-ahmed-hosny-role.cjs --id=USER_ID'
      );
      console.error('');
      console.error('No database changes were made.');
      return;
    }

    if (ahmedHosnyMatches.length > 1) {
      console.error('');
      console.error(
        'More than one Ahmed Hosny candidate was found.'
      );

      console.table(
        ahmedHosnyMatches.map((u) => ({
          id: u.id,
          fullName: u.fullName,
          username: u.username,
          email: u.email,
          role: u.role?.name,
        }))
      );

      console.error('');
      console.error(
        'For safety choose the correct ID and run:'
      );
      console.error(
        'node scripts/fix-ahmed-hosny-role.cjs --id=USER_ID'
      );
      console.error('');
      console.error('No database changes were made.');
      return;
    }

    targetUser = ahmedHosnyMatches[0];
  }

  // -------------------------------------------
  // 5) عرض حالة أحمد قبل أي تعديل
  // -------------------------------------------
  console.log('');
  console.log('----------------------------------------------');
  console.log('AHMED HOSNY CURRENT DATABASE ACCOUNT');
  console.log('----------------------------------------------');

  console.table([
    {
      id: targetUser.id,
      fullName: targetUser.fullName,
      firstName: targetUser.firstName,
      lastName: targetUser.lastName,
      username: targetUser.username,
      email: targetUser.email,
      jobTitle: targetUser.jobTitle,
      roleId: targetUser.roleId,
      role: targetUser.role?.name,
      isActive: targetUser.isActive,
      status: targetUser.status,
    },
  ]);

  const currentRole = normalize(targetUser.role?.name);

  const alreadyTechnician =
    currentRole === 'technician' ||
    currentRole === 'tech' ||
    currentRole === 'فني';

  if (alreadyTechnician) {
    console.log('');
    console.log('==============================================');
    console.log('OK: Ahmed Hosny is ALREADY TECHNICIAN.');
    console.log('==============================================');
    console.log('');
    console.log(
      'If the mobile app still opens Viewer, then the problem is in the Flutter login/routing or an old APK.'
    );
    return;
  }

  console.log('');
  console.log(
    `WARNING: Ahmed Hosny is currently role=${targetUser.role?.name ?? 'NULL'}`
  );

  console.log(
    `Required role => ${technicianRole.name}`
  );

  // -------------------------------------------
  // 6) Preview فقط
  // -------------------------------------------
  if (!APPLY) {
    console.log('');
    console.log('==============================================');
    console.log('PREVIEW ONLY - NOTHING WAS CHANGED');
    console.log('==============================================');
    console.log('');
    console.log('To change ONLY this user to TECHNICIAN run:');
    console.log('');
    console.log(
      `node scripts/fix-ahmed-hosny-role.cjs --id=${targetUser.id} --apply`
    );
    console.log('');

    return;
  }

  // -------------------------------------------
  // 7) تغيير roleId فقط
  // لا نمس كلمة السر
  // لا نمس التفتيشات
  // لا نمس أي بيانات أخرى
  // -------------------------------------------
  console.log('');
  console.log('Updating Ahmed Hosny role...');

  await prisma.user.update({
    where: {
      id: targetUser.id,
    },
    data: {
      roleId: technicianRole.id,
    },
  });

  // -------------------------------------------
  // 8) تأكيد من قاعدة البيانات بعد التعديل
  // -------------------------------------------
  const after = await prisma.user.findUnique({
    where: {
      id: targetUser.id,
    },
    include: {
      role: true,
    },
  });

  console.log('');
  console.log('==============================================');
  console.log('DATABASE AFTER UPDATE');
  console.log('==============================================');

  console.table([
    {
      id: after.id,
      fullName: after.fullName,
      username: after.username,
      email: after.email,
      roleId: after.roleId,
      role: after.role?.name,
      isActive: after.isActive,
      status: after.status,
    },
  ]);

  const finalRole = normalize(after.role?.name);

  if (
    finalRole === 'technician' ||
    finalRole === 'tech' ||
    finalRole === 'فني'
  ) {
    console.log('');
    console.log('==============================================');
    console.log('SUCCESS');
    console.log(`Ahmed Hosny => ${after.role.name}`);
    console.log('==============================================');
    console.log('');
    console.log(
      'Now LOG OUT from the mobile app completely and login again.'
    );
  } else {
    throw new Error(
      `Role verification failed. Current role=${after.role?.name}`
    );
  }
}

main()
  .catch((error) => {
    console.error('');
    console.error('FAILED:');
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });