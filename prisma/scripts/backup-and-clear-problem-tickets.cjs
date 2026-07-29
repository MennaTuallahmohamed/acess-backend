/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const {
  stdin: input,
  stdout: output,
} = require("node:process");

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const CONFIRM_TEXT = "DELETE PROBLEM TICKETS";

/**
 * إنشاء اسم زمني آمن لاسم ملف الـBackup.
 */
function createTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
}

/**
 * قراءة كل سجلات ProblemTicket
 * قبل تنفيذ أي حذف.
 */
async function readProblemTickets() {
  return prisma.problemTicket.findMany({
    orderBy: {
      id: "asc",
    },
  });
}

/**
 * حفظ نسخة JSON داخل:
 * C:\backend\backups
 */
function saveBackup(problemTickets) {
  const backupDirectory = path.resolve(
    process.cwd(),
    "backups",
  );

  fs.mkdirSync(backupDirectory, {
    recursive: true,
  });

  const backupFileName =
    `problem-tickets-${createTimestamp()}.json`;

  const backupFilePath = path.join(
    backupDirectory,
    backupFileName,
  );

  const backupContent = {
    meta: {
      createdAt: new Date().toISOString(),
      table: "ProblemTicket",
      count: problemTickets.length,
      description:
        "Backup created before deleting Software Problems test records.",
    },

    data: problemTickets,
  };

  fs.writeFileSync(
    backupFilePath,
    JSON.stringify(backupContent, null, 2),
    "utf8",
  );

  return backupFilePath;
}

/**
 * حذف سجلات ProblemTicket فقط.
 *
 * لا يتم حذف:
 * - Global Tasks
 * - Issues
 * - IssueSolutions
 * - Users
 * - Locations
 * - Devices
 * - Gates
 * - Glasses
 */
async function deleteProblemTickets() {
  return prisma.$transaction(
    async (transaction) => {
      return transaction.problemTicket.deleteMany({});
    },
    {
      maxWait: 10000,
      timeout: 120000,
    },
  );
}

async function main() {
  const shouldDelete =
    process.argv.includes("--clear");

  console.log("");
  console.log("======================================");
  console.log(" SmartIT Problem Tickets Backup Tool");
  console.log("======================================");
  console.log("");

  console.log(
    "Reading ProblemTicket records...",
  );

  const problemTickets =
    await readProblemTickets();

  console.log(
    `ProblemTicket rows found: ${problemTickets.length}`,
  );

  console.log("");
  console.log("Creating backup...");

  const backupFilePath =
    saveBackup(problemTickets);

  console.log("");
  console.log("Backup created successfully:");
  console.log(backupFilePath);
  console.log("");

  /**
   * بدون --clear:
   * السكربت يعمل Backup فقط.
   */
  if (!shouldDelete) {
    console.log("No data was deleted.");
    console.log("");
    console.log(
      "After checking the backup file, run:",
    );
    console.log("");
    console.log(
      "node .\\prisma\\scripts\\backup-and-clear-problem-tickets.cjs --clear",
    );
    console.log("");

    return;
  }

  /**
   * لا داعي للحذف لو الجدول فارغ.
   */
  if (problemTickets.length === 0) {
    console.log(
      "ProblemTicket is already empty.",
    );
    console.log("Nothing was deleted.");
    console.log("");

    return;
  }

  console.log(
    "WARNING: This will delete ONLY ProblemTicket rows.",
  );

  console.log(
    "Global Tasks, Issues, Solutions, Users and assets will not be deleted.",
  );

  console.log("");

  const readlineInterface =
    readline.createInterface({
      input,
      output,
    });

  const answer =
    await readlineInterface.question(
      `Type exactly "${CONFIRM_TEXT}" to continue: `,
    );

  readlineInterface.close();

  /**
   * منع الحذف في حالة كتابة أي نص مختلف.
   */
  if (answer.trim() !== CONFIRM_TEXT) {
    console.log("");
    console.log(
      "Confirmation did not match.",
    );
    console.log("Nothing was deleted.");
    console.log("");

    return;
  }

  console.log("");
  console.log(
    "Deleting ProblemTicket rows...",
  );

  const deleteResult =
    await deleteProblemTickets();

  console.log("");
  console.log("Deletion completed successfully.");
  console.log(
    `Deleted ProblemTicket rows: ${deleteResult.count}`,
  );

  console.log("");
  console.log("Preserved data:");

  console.log("- Global Tasks");
  console.log("- Issue Categories");
  console.log("- Issues");
  console.log("- Issue Solutions");
  console.log("- Users");
  console.log("- Roles");
  console.log("- Locations");
  console.log("- Devices");
  console.log("- Gates");
  console.log("- Glasses");

  console.log("");
  console.log("Backup retained at:");
  console.log(backupFilePath);
  console.log("");
}

main()
  .catch((error) => {
    console.error("");
    console.error(
      "The operation failed.",
    );

    console.error(
      "Do not assume that deletion was completed.",
    );

    console.error("");
    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });