const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const prisma = new PrismaClient();

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function backupFileName() {
  const d = new Date();

  const stamp = d
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\./g, "-");

  return `gates-backup-${stamp}.json`;
}

async function main() {
  console.log("");
  console.log("======================================");
  console.log("   GATES BACKUP + CLEAR SCRIPT");
  console.log("======================================");
  console.log("");

  // ---------------------------------------------------
  // 1) READ CURRENT DATA
  // ---------------------------------------------------

  const gates = await prisma.gate.findMany({
    orderBy: {
      id: "asc",
    },
  });

  const inspections = await prisma.inspection.findMany({
    where: {
      gateId: {
        not: null,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  const tasks = await prisma.inspectionTask.findMany({
    where: {
      gateId: {
        not: null,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  const taskItems = await prisma.inspectionTaskItem.findMany({
    where: {
      gateId: {
        not: null,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  const activityLogs = await prisma.technicianActivityLog.findMany({
    where: {
      gateId: {
        not: null,
      },
    },
    orderBy: {
      id: "asc",
    },
  });

  console.log("CURRENT DATABASE:");
  console.log("--------------------------------------");
  console.log(`Gates              : ${gates.length}`);
  console.log(`Gate Inspections   : ${inspections.length}`);
  console.log(`Gate Tasks         : ${tasks.length}`);
  console.log(`Gate Task Items    : ${taskItems.length}`);
  console.log(`Gate Activity Logs : ${activityLogs.length}`);
  console.log("--------------------------------------");
  console.log("");

  if (gates.length === 0) {
    console.log("No Gate records found.");
    console.log("Nothing will be deleted.");
    return;
  }

  // ---------------------------------------------------
  // 2) CREATE BACKUP
  // ---------------------------------------------------

  const backupDir = path.join(process.cwd(), "backups");

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, {
      recursive: true,
    });
  }

  const fileName = backupFileName();
  const backupPath = path.join(backupDir, fileName);

  const backup = {
    backupInfo: {
      createdAt: new Date().toISOString(),
      type: "GATE_FULL_BACKUP_BEFORE_DELETE",
      gateCount: gates.length,
      inspectionLinksCount: inspections.length,
      taskLinksCount: tasks.length,
      taskItemLinksCount: taskItems.length,
      activityLogLinksCount: activityLogs.length,
    },

    gates,

    linkedData: {
      inspections,
      tasks,
      taskItems,
      activityLogs,
    },
  };

  fs.writeFileSync(
    backupPath,
    JSON.stringify(backup, null, 2),
    "utf8"
  );

  // ---------------------------------------------------
  // 3) VERIFY BACKUP
  // ---------------------------------------------------

  if (!fs.existsSync(backupPath)) {
    throw new Error("BACKUP FILE WAS NOT CREATED. DELETE ABORTED.");
  }

  const savedBackup = JSON.parse(
    fs.readFileSync(backupPath, "utf8")
  );

  if (
    !savedBackup.gates ||
    savedBackup.gates.length !== gates.length
  ) {
    throw new Error(
      "BACKUP VERIFICATION FAILED. DELETE ABORTED."
    );
  }

  console.log("BACKUP CREATED SUCCESSFULLY");
  console.log("--------------------------------------");
  console.log(backupPath);
  console.log("");
  console.log(`Verified Gates: ${savedBackup.gates.length}`);
  console.log("");
  console.log("NO DATA HAS BEEN DELETED YET.");
  console.log("");

  // ---------------------------------------------------
  // 4) SAFETY CONFIRMATION
  // ---------------------------------------------------

  const confirmation = await ask(
    'To CLEAR ALL Gates type exactly: DELETE-GATES\n> '
  );

  if (confirmation !== "DELETE-GATES") {
    console.log("");
    console.log("CANCELLED.");
    console.log("No database data was changed.");
    return;
  }

  console.log("");
  console.log("Starting database transaction...");
  console.log("");

  // ---------------------------------------------------
  // 5) REMOVE GATE LINKS + DELETE GATES
  // ---------------------------------------------------

  const result = await prisma.$transaction(
    async (tx) => {

      // Keep historical Activity Logs
      // but remove FK to old Gate IDs
      const logsResult =
        await tx.technicianActivityLog.updateMany({
          where: {
            gateId: {
              not: null,
            },
          },
          data: {
            gateId: null,
          },
        });

      // Keep historical Task Items
      const taskItemsResult =
        await tx.inspectionTaskItem.updateMany({
          where: {
            gateId: {
              not: null,
            },
          },
          data: {
            gateId: null,
          },
        });

      // Keep historical Tasks
      const tasksResult =
        await tx.inspectionTask.updateMany({
          where: {
            gateId: {
              not: null,
            },
          },
          data: {
            gateId: null,
          },
        });

      // Keep historical Inspections
      const inspectionsResult =
        await tx.inspection.updateMany({
          where: {
            gateId: {
              not: null,
            },
          },
          data: {
            gateId: null,
          },
        });

      // Finally delete ONLY Gates
      const gatesResult =
        await tx.gate.deleteMany({});

      return {
        logs: logsResult.count,
        taskItems: taskItemsResult.count,
        tasks: tasksResult.count,
        inspections: inspectionsResult.count,
        gates: gatesResult.count,
      };
    },
    {
      timeout: 120000,
    }
  );

  // ---------------------------------------------------
  // 6) FINAL VERIFICATION
  // ---------------------------------------------------

  const remainingGates = await prisma.gate.count();

  console.log("======================================");
  console.log("          OPERATION COMPLETE");
  console.log("======================================");
  console.log("");

  console.log(`Activity links removed : ${result.logs}`);
  console.log(`TaskItem links removed : ${result.taskItems}`);
  console.log(`Task links removed     : ${result.tasks}`);
  console.log(`Inspection links       : ${result.inspections}`);
  console.log(`Gates DELETED          : ${result.gates}`);

  console.log("");
  console.log(`Gates remaining        : ${remainingGates}`);
  console.log("");

  console.log("BACKUP:");
  console.log(backupPath);
  console.log("");

  if (remainingGates === 0) {
    console.log("SUCCESS: Gate table is now empty.");
  } else {
    console.log(
      "WARNING: Some Gate records still exist."
    );
  }

  console.log("");
}

main()
  .catch((error) => {
    console.error("");
    console.error("======================================");
    console.error("FAILED - DATABASE NOT SAFELY CLEARED");
    console.error("======================================");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });