const { PrismaClient } = require("@prisma/client");

let bcrypt;

try {
  bcrypt = require("bcrypt");
} catch {
  bcrypt = require("bcryptjs");
}

const prisma = new PrismaClient();

const TEST_PASSWORD = "123456";

// اكتبي الإيميل الثاني عند تشغيل الملف، وليس هنا.
const emails = process.argv.slice(2);

function printDatabaseInfo() {
  try {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      console.log("DATABASE_URL: NOT FOUND");
      return;
    }

    const parsed = new URL(databaseUrl);

    console.log("\n========== DATABASE ==========");
    console.log("Host:", parsed.hostname);
    console.log("Port:", parsed.port || "default");
    console.log("Database:", parsed.pathname.replace("/", ""));
    console.log("==============================\n");
  } catch {
    console.log("Could not read DATABASE_URL information.");
  }
}

function detectPasswordField(user) {
  const possibleFields = [
    "password",
    "passwordHash",
    "hashedPassword",
    "hash",
  ];

  return possibleFields.find(
    (field) =>
      Object.prototype.hasOwnProperty.call(user, field) &&
      typeof user[field] === "string",
  );
}

function looksLikeBcrypt(value) {
  return /^\$2[aby]\$\d{2}\$/.test(value || "");
}

async function checkEmail(email) {
  console.log("\n========================================");
  console.log("CHECKING:", email);
  console.log("========================================");

  const users = await prisma.user.findMany({
    where: {
      email: {
        equals: email.trim(),
        mode: "insensitive",
      },
    },
  });

  if (users.length === 0) {
    console.log("RESULT: USER NOT FOUND");
    console.log("Meaning:");
    console.log("- الحساب غير موجود في قاعدة البيانات الحالية");
    console.log("- أو الباك إند متصل بقاعدة بيانات مختلفة");
    console.log("- أو الإيميل محفوظ بمسافات/شكل مختلف");
    return;
  }

  console.log("Matched users count:", users.length);

  if (users.length > 1) {
    console.log("WARNING: DUPLICATE USERS FOUND");
    console.log("هناك أكثر من حساب بنفس الإيميل.");
  }

  for (const user of users) {
    console.log("\n--- USER RECORD ---");
    console.log("ID:", user.id);
    console.log("Stored email:", JSON.stringify(user.email));

    if ("isActive" in user) {
      console.log("isActive:", user.isActive);
    }

    if ("active" in user) {
      console.log("active:", user.active);
    }

    if ("status" in user) {
      console.log("status:", user.status);
    }

    if ("deletedAt" in user) {
      console.log("deletedAt:", user.deletedAt);
    }

    const passwordField = detectPasswordField(user);

    if (!passwordField) {
      console.log("RESULT: PASSWORD FIELD NOT DETECTED");
      console.log("Available fields:", Object.keys(user).join(", "));
      continue;
    }

    const storedPassword = user[passwordField];

    console.log("Password field:", passwordField);
    console.log("Password exists:", Boolean(storedPassword));
    console.log("Password length:", storedPassword?.length || 0);
    console.log("Looks like bcrypt:", looksLikeBcrypt(storedPassword));

    if (!storedPassword) {
      console.log("RESULT: EMPTY PASSWORD");
      continue;
    }

    try {
      const matches = await bcrypt.compare(
        TEST_PASSWORD,
        storedPassword,
      );

      console.log("bcrypt.compare('123456'):", matches);

      if (matches) {
        console.log("RESULT: PASSWORD IS CORRECT IN DATABASE");
        console.log(
          "لو الـ API ما زالت ترجع 401 فالمشكلة داخل auth.service.ts أو validateUser.",
        );
      } else {
        console.log("RESULT: PASSWORD DOES NOT MATCH DATABASE");
        console.log(
          "الحساب موجود، لكن كلمة السر المخزنة ليست تشفير 123456.",
        );
      }
    } catch (error) {
      console.log("RESULT: PASSWORD COMPARE ERROR");
      console.log("Error:", error.message);
      console.log(
        "غالبًا كلمة السر محفوظة Plain Text أو بخوارزمية تشفير مختلفة.",
      );
    }
  }
}

async function main() {
  if (emails.length === 0) {
    console.log(
      'Usage: node diagnose-login.cjs "email1@example.com" "email2@example.com"',
    );
    return;
  }

  printDatabaseInfo();

  for (const email of emails) {
    await checkEmail(email);
  }
}

main()
  .catch((error) => {
    console.error("\nDIAGNOSTIC FAILED");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });