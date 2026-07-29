require("dotenv").config();

const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { stdin: input, stdout: output } = require("process");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const BACKUP_PATH =
  "C:\\backend\\backups\\global-tasks-user-56-2026-07-27T13-08-20-626Z.json";

const APPLY_MODE = process.argv.includes("--apply");

function uniqueIntegerIds(values) {
  return [
    ...new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    ),
  ];
}

async function main() {
  console.log("");
  console.log("========================================");
  console.log(" SmartIT Global Tasks Deletion");
  console.log("========================================");
  console.log("");

  if (!fs.existsSync(BACKUP_PATH)) {
    throw new Error(`Backup file was not found:\n${BACKUP_PATH}`);
  }

  const backup = JSON.parse(
    fs.readFileSync(BACKUP_PATH, "utf8"),
  );

  if (!Array.isArray(backup.tasks) || backup.tasks.length === 0) {
    throw new Error("The backup does not contain Global Tasks.");
  }

  /*
   * حماية مهمة:
   * السكربت يرفض العمل لو الـBackup يحتوي على مهمة
   * ليست من نوع GLOBAL_ROUTE.
   */
  const invalidTasks = backup.tasks.filter(
    (task) => task.taskKind !== "GLOBAL_ROUTE",
  );

  if (invalidTasks.length > 0) {
    throw new Error(
      `Deletion stopped because ${invalidTasks.length} task(s) are not GLOBAL_ROUTE.`,
    );
  }

  const backupTaskIds = uniqueIntegerIds(
    backup.tasks.map((task) => task.id),
  );

  console.log("Backup file:");
  console.log(BACKUP_PATH);
  console.log("");

  console.log("Task IDs recorded in backup:");
  console.log(backupTaskIds.join(", "));
  console.log("");

  const liveTasks = await prisma.inspectionTask.findMany({
    where: {
      id: {
        in: backupTaskIds,
      },

      taskKind: "GLOBAL_ROUTE",
    },

    select: {
      id: true,
      title: true,
      status: true,
      taskKind: true,
      assetType: true,
      assignedToId: true,
      scheduledDate: true,

      items: {
        select: {
          id: true,
          status: true,
          deviceId: true,
          gateId: true,
          glassId: true,
        },

        orderBy: {
          id: "asc",
        },
      },
    },

    orderBy: {
      id: "asc",
    },
  });

  const liveTaskIds = uniqueIntegerIds(
    liveTasks.map((task) => task.id),
  );

  const taskItemIds = uniqueIntegerIds(
    liveTasks.flatMap((task) =>
      task.items.map((item) => item.id),
    ),
  );

  const missingTaskIds = backupTaskIds.filter(
    (id) => !liveTaskIds.includes(id),
  );

  console.log("Global Tasks found in database:", liveTasks.length);
  console.log("Task Items that will be deleted:", taskItemIds.length);
  console.log("");

  if (missingTaskIds.length > 0) {
    console.log(
      "Backup task IDs already missing from database:",
      missingTaskIds.join(", "),
    );
    console.log("");
  }

  liveTasks.forEach((task) => {
    console.log("----------------------------------------");
    console.log("Task ID:", task.id);
    console.log("Title:", task.title || "Untitled Global Task");
    console.log("Status:", task.status);
    console.log("Task Kind:", task.taskKind);
    console.log("Asset Type:", task.assetType);
    console.log("Items:", task.items.length);
    console.log("Scheduled:", task.scheduledDate);
  });

  if (liveTasks.length === 0) {
    console.log("");
    console.log("No matching Global Tasks remain in the database.");
    console.log("Nothing was deleted.");
    return;
  }

  /*
   * بعض السجلات التاريخية قد تشير إلى Task أو TaskItem.
   * نفصل هذه الروابط فقط حتى لا نحذف السجل التاريخي نفسه.
   */
  const relatedInspections =
    await prisma.inspection.count({
      where: {
        taskId: {
          in: liveTaskIds,
        },
      },
    });

  const relatedActivityLogs =
    await prisma.technicianActivityLog.count({
      where: {
        OR: [
          {
            taskId: {
              in: liveTaskIds,
            },
          },

          ...(taskItemIds.length
            ? [
                {
                  taskItemId: {
                    in: taskItemIds,
                  },
                },
              ]
            : []),
        ],
      },
    });

  const relatedMorphoRepairs = taskItemIds.length
    ? await prisma.deviceMorphoRepair.count({
        where: {
          taskItemId: {
            in: taskItemIds,
          },
        },
      })
    : 0;

  const relatedReplacements = taskItemIds.length
    ? await prisma.deviceReplacement.count({
        where: {
          taskItemId: {
            in: taskItemIds,
          },
        },
      })
    : 0;

  console.log("");
  console.log("Related records that will be preserved and unlinked:");
  console.log("Inspections:", relatedInspections);
  console.log("Activity Logs:", relatedActivityLogs);
  console.log("Morpho Repairs:", relatedMorphoRepairs);
  console.log("Device Replacements:", relatedReplacements);
  console.log("");

  if (!APPLY_MODE) {
    console.log("PREVIEW ONLY — nothing was deleted.");
    console.log("");
    console.log("To perform the deletion, run:");
    console.log(
      "node .\\prisma\\scripts\\delete-backed-up-global-tasks.cjs --apply",
    );
    return;
  }

  const rl = readline.createInterface({
    input,
    output,
  });

  const confirmation = await rl.question(
    'Type "DELETE GLOBAL TASKS" to confirm: ',
  );

  rl.close();

  if (confirmation.trim() !== "DELETE GLOBAL TASKS") {
    console.log("");
    console.log("Confirmation did not match.");
    console.log("Nothing was deleted.");
    return;
  }

  const result = await prisma.$transaction(
    async (tx) => {
      /*
       * نحافظ على السجلات التاريخية ولا نحذفها.
       * فقط نفصلها عن المهام التي سيتم حذفها.
       */

      if (taskItemIds.length > 0) {
        await tx.deviceMorphoRepair.updateMany({
          where: {
            taskItemId: {
              in: taskItemIds,
            },
          },

          data: {
            taskItemId: null,
          },
        });

        await tx.deviceReplacement.updateMany({
          where: {
            taskItemId: {
              in: taskItemIds,
            },
          },

          data: {
            taskItemId: null,
          },
        });

        await tx.technicianActivityLog.updateMany({
          where: {
            taskItemId: {
              in: taskItemIds,
            },
          },

          data: {
            taskItemId: null,
          },
        });
      }

      await tx.technicianActivityLog.updateMany({
        where: {
          taskId: {
            in: liveTaskIds,
          },
        },

        data: {
          taskId: null,
        },
      });

      await tx.inspection.updateMany({
        where: {
          taskId: {
            in: liveTaskIds,
          },
        },

        data: {
          taskId: null,
        },
      });

      /*
       * حذف InspectionTask يحذف InspectionTaskItem
       * التابعة له تلقائيًا بسبب onDelete: Cascade.
       */
      const deletedTasks =
        await tx.inspectionTask.deleteMany({
          where: {
            id: {
              in: liveTaskIds,
            },

            taskKind: "GLOBAL_ROUTE",
          },
        });

      return {
        deletedTasks: deletedTasks.count,
        deletedTaskItems: taskItemIds.length,
      };
    },
    {
      maxWait: 10000,
      timeout: 60000,
    },
  );

  const remainingTasks =
    await prisma.inspectionTask.count({
      where: {
        id: {
          in: liveTaskIds,
        },
      },
    });

  const reportsDirectory = path.join(
    process.cwd(),
    "backups",
  );

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  const reportPath = path.join(
    reportsDirectory,
    `global-tasks-deletion-report-${timestamp}.json`,
  );

  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        deletedAt: new Date().toISOString(),
        sourceBackup: BACKUP_PATH,
        responsibleUser: backup.responsibleUser || null,
        deletedTaskIds: liveTaskIds,
        deletedTaskItemIds: taskItemIds,
        result,
        remainingTasks,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log("");
  console.log("========================================");
  console.log(" Global Tasks deletion completed");
  console.log("========================================");
  console.log("");
  console.log("Deleted Global Tasks:", result.deletedTasks);
  console.log(
    "Deleted Task Items:",
    result.deletedTaskItems,
  );
  console.log("Remaining matching Tasks:", remainingTasks);
  console.log("");
  console.log("Deletion report:");
  console.log(reportPath);
  console.log("");
  console.log("ProblemTicket was not accessed.");
  console.log("Issue and IssueSolution were not accessed.");
  console.log("Devices, Gates and Users were not deleted.");
}

main()
  .catch((error) => {
    console.error("");
    console.error("Global Tasks deletion failed.");
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