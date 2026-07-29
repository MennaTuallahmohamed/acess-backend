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

const CONFIRM_TEXT = "DELETE EXACT DUPLICATES";

function createTimestamp() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-");
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ar");
}

function normalizeDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value).slice(0, 10);
  }

  return date.toISOString().slice(0, 10);
}

/**
 * التكرار يعتبر مطابقًا فقط عندما تتطابق:
 *
 * - الفئة
 * - تاريخ المشكلة
 * - مكان المشكلة
 * - وصف المشكلة
 * - الحل
 * - الأولوية
 *
 * createdAt و id غير داخلين في المقارنة؛
 * لأنهما مختلفان في كل مرة تم فيها استيراد نفس الصف.
 */
function createDuplicateKey(ticket) {
  return JSON.stringify([
    String(ticket.type || ""),
    normalizeDate(ticket.problemDate),
    normalizeText(ticket.locationText),
    normalizeText(ticket.description),
    normalizeText(ticket.solutionText),
    String(ticket.priority || ""),
  ]);
}

function createBackup(tickets) {
  const backupDirectory = path.resolve(
    process.cwd(),
    "backups",
  );

  fs.mkdirSync(backupDirectory, {
    recursive: true,
  });

  const backupPath = path.join(
    backupDirectory,
    `problem-tickets-before-dedupe-${createTimestamp()}.json`,
  );

  const content = {
    meta: {
      createdAt: new Date().toISOString(),
      table: "ProblemTicket",
      count: tickets.length,
      operation:
        "Backup before deleting exact duplicate ProblemTicket rows",
    },

    data: tickets,
  };

  fs.writeFileSync(
    backupPath,
    JSON.stringify(content, null, 2),
    "utf8",
  );

  return backupPath;
}

function splitIntoChunks(values, size = 500) {
  const chunks = [];

  for (
    let index = 0;
    index < values.length;
    index += size
  ) {
    chunks.push(
      values.slice(index, index + size),
    );
  }

  return chunks;
}

async function main() {
  const shouldApply =
    process.argv.includes("--apply");

  console.log("");
  console.log("========================================");
  console.log(" SmartIT Problem Ticket Deduplication");
  console.log("========================================");
  console.log("");

  const tickets =
    await prisma.problemTicket.findMany({
      orderBy: {
        id: "asc",
      },
    });

  const backupPath = createBackup(tickets);

  const firstTicketByKey = new Map();
  const duplicateTickets = [];
  const duplicateGroups = new Map();

  for (const ticket of tickets) {
    const key = createDuplicateKey(ticket);

    if (!firstTicketByKey.has(key)) {
      firstTicketByKey.set(key, ticket);
      continue;
    }

    duplicateTickets.push(ticket);

    const original =
      firstTicketByKey.get(key);

    if (!duplicateGroups.has(key)) {
      duplicateGroups.set(key, {
        keptId: original.id,
        duplicateIds: [],
        title:
          original.title ||
          String(original.description || "")
            .slice(0, 80),
        locationText:
          original.locationText || "",
        problemDate:
          normalizeDate(original.problemDate),
      });
    }

    duplicateGroups
      .get(key)
      .duplicateIds
      .push(ticket.id);
  }

  const uniqueCount =
    firstTicketByKey.size;

  console.log(`Rows currently in database: ${tickets.length}`);
  console.log(`Exact unique rows: ${uniqueCount}`);
  console.log(`Duplicate rows found: ${duplicateTickets.length}`);
  console.log(`Duplicate groups: ${duplicateGroups.size}`);

  console.log("");
  console.log("Backup created successfully:");
  console.log(backupPath);
  console.log("");

  const samples = Array.from(
    duplicateGroups.values(),
  ).slice(0, 10);

  if (samples.length) {
    console.log("Duplicate examples:");

    for (const group of samples) {
      console.log("----------------------------------");
      console.log(`Keeping ID: ${group.keptId}`);
      console.log(
        `Deleting IDs: ${group.duplicateIds.join(", ")}`,
      );
      console.log(`Date: ${group.problemDate}`);
      console.log(`Location: ${group.locationText}`);
      console.log(`Issue: ${group.title}`);
    }

    console.log("----------------------------------");
    console.log("");
  }

  if (!shouldApply) {
    console.log("PREVIEW ONLY — nothing was deleted.");
    console.log("");
    console.log(
      "Check the unique and duplicate counts above.",
    );
    console.log("");
    console.log(
      "To delete only the exact duplicates, run:",
    );
    console.log("");
    console.log(
      "node .\\prisma\\scripts\\backup-and-dedupe-problem-tickets.cjs --apply",
    );
    console.log("");

    return;
  }

  if (!duplicateTickets.length) {
    console.log(
      "No exact duplicate ProblemTicket rows were found.",
    );

    return;
  }

  const readlineInterface =
    readline.createInterface({
      input,
      output,
    });

  const answer =
    await readlineInterface.question(
      `Type exactly "${CONFIRM_TEXT}" to delete ${duplicateTickets.length} duplicate row(s): `,
    );

  readlineInterface.close();

  if (answer.trim() !== CONFIRM_TEXT) {
    console.log("");
    console.log("Confirmation did not match.");
    console.log("Nothing was deleted.");

    return;
  }

  const duplicateIds =
    duplicateTickets.map(
      (ticket) => ticket.id,
    );

  const chunks =
    splitIntoChunks(duplicateIds);

  const deleteOperations =
    chunks.map((ids) =>
      prisma.problemTicket.deleteMany({
        where: {
          id: {
            in: ids,
          },
        },
      }),
    );

  const results =
    await prisma.$transaction(
      deleteOperations,
    );

  const deletedCount =
    results.reduce(
      (total, result) =>
        total + result.count,
      0,
    );

  const remainingCount =
    await prisma.problemTicket.count();

  console.log("");
  console.log("Deduplication completed successfully.");
  console.log(`Deleted duplicate rows: ${deletedCount}`);
  console.log(`Remaining unique rows: ${remainingCount}`);
  console.log("");
  console.log("No unique row was intentionally deleted.");
  console.log("Backup retained at:");
  console.log(backupPath);
  console.log("");
}

main()
  .catch((error) => {
    console.error("");
    console.error("Deduplication failed.");
    console.error(
      "Do not assume the deletion was completed.",
    );
    console.error("");
    console.error(error);

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });