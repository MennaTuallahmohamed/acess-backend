const { PrismaClient } = require('@prisma/client');

let bcrypt;

try {
  bcrypt = require('bcrypt');
} catch {
  try {
    bcrypt = require('bcryptjs');
  } catch {
    console.error('ERROR: bcrypt / bcryptjs is not installed.');
    console.error('Run: npm install bcrypt');
    process.exit(1);
  }
}

const prisma = new PrismaClient();

const USER_ID = 18;
const EXPECTED_EMAIL = 'menna7mohamed@gmail.com';

const APPLY = process.argv.includes('--apply');

async function main() {
  console.log('');
  console.log('==============================================');
  console.log('      RESET MENNA7 PASSWORD - SAFE MODE');
  console.log('==============================================');
  console.log('');

  const user = await prisma.user.findUnique({
    where: {
      id: USER_ID,
    },
    include: {
      role: true,
    },
  });

  if (!user) {
    throw new Error(`User ID ${USER_ID} was not found.`);
  }

  console.table([
    {
      id: user.id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      roleId: user.roleId,
      role: user.role?.name,
      isActive: user.isActive,
      status: user.status,
    },
  ]);

  // حماية مهمة: نتأكد إن ID 18 هو فعلًا Menna7
  if (
    String(user.email || '').trim().toLowerCase() !==
    EXPECTED_EMAIL.toLowerCase()
  ) {
    throw new Error(
      `SAFETY STOP: User ID ${USER_ID} email is ${user.email}, expected ${EXPECTED_EMAIL}`
    );
  }

  if (!user.isActive || String(user.status).toUpperCase() !== 'ACTIVE') {
    throw new Error('SAFETY STOP: Menna7 account is not ACTIVE.');
  }

  const newPassword = process.env.NEW_PASSWORD;

  if (!newPassword) {
    console.log('');
    console.log('No NEW_PASSWORD supplied.');
    console.log('');
    console.log('Set it first in PowerShell:');
    console.log('$env:NEW_PASSWORD="123456"');
    console.log('');
    return;
  }

  if (!APPLY) {
    console.log('');
    console.log('==============================================');
    console.log('PREVIEW ONLY - NOTHING CHANGED');
    console.log('==============================================');
    console.log('');
    console.log(`Target ID    : ${user.id}`);
    console.log(`Target email : ${user.email}`);
    console.log(`Role         : ${user.role?.name}`);
    console.log('');
    console.log('To apply:');
    console.log(
      'node scripts/reset-menna7-password.cjs --apply'
    );
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);

  await prisma.user.update({
    where: {
      id: USER_ID,
    },
    data: {
      passwordHash,
    },
  });

  // نتأكد إن الباسورد الجديد يطابق الهاش المحفوظ
  const after = await prisma.user.findUnique({
    where: {
      id: USER_ID,
    },
    include: {
      role: true,
    },
  });

  const passwordVerified = await bcrypt.compare(
    newPassword,
    after.passwordHash
  );

  console.log('');
  console.log('==============================================');
  console.log('             AFTER PASSWORD RESET');
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
      passwordVerified,
    },
  ]);

  if (!passwordVerified) {
    throw new Error('Password verification failed.');
  }

  console.log('');
  console.log('==============================================');
  console.log('SUCCESS');
  console.log('Menna7 password was reset successfully.');
  console.log('NO ROLE WAS CHANGED.');
  console.log('NO OTHER USER WAS CHANGED.');
  console.log('==============================================');
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