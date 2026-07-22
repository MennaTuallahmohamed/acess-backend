import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import XLSX from "xlsx";
import cliProgress from "cli-progress";
import pLimit from "p-limit";

const config = {
  apiUrl: process.env.API_URL,
  apiToken: process.env.API_TOKEN || "",

  excelFile:
    process.env.EXCEL_FILE ||
    "./SMART_IT_350_PRODUCTS_DAOSAFE_CAME_AUTOMATIC.xlsx",

  sheetName: process.env.SHEET_NAME || "350 Products",

  concurrency: Number(process.env.CONCURRENCY || 5),
  timeout: Number(process.env.REQUEST_TIMEOUT_MS || 30000),
  retries: Number(process.env.MAX_RETRIES || 3),
};

function text(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function number(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function relatedProducts(value) {
  return text(value)
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readProducts() {
  const filePath = path.resolve(config.excelFile);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath);
  const worksheet = workbook.Sheets[config.sheetName];

  if (!worksheet) {
    throw new Error(
      `Sheet "${config.sheetName}" not found. Available sheets: ${workbook.SheetNames.join(", ")}`
    );
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    defval: null,
    raw: false,
  });

  return rows
    .map((row, index) => ({
      rowNumber: index + 2,

      name: text(row["Product Name"]),
      brand: text(row["Brand"]),
      mainCategory: text(row["Main Category"]),
      subcategory: text(row["Subcategory"]),
      productType: text(row["Product Type"]),
      description: text(row["Description"]),

      productUrl: text(row["Product URL"]) || null,
      imageUrl: text(row["Image URL / Data URI"]) || null,

      relatedProducts: relatedProducts(row["Related Products"]),

      sku: text(row["Internal Reference"]) || null,
      price: number(row["Sales Price"]),
      quantity: number(row["Quantity On Hand"]),

      source: text(row["Source Type"]) || null,
    }))
    .filter((product) => product.name);
}

function createApiClient() {
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  if (config.apiToken) {
    headers.Authorization = `Bearer ${config.apiToken}`;
  }

  return axios.create({
    baseURL: config.apiUrl,
    headers,
    timeout: config.timeout,
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function uploadProduct(client, product) {
  let lastError;

  for (let attempt = 1; attempt <= config.retries + 1; attempt++) {
    try {
      const response = await client.post("", {
        name: product.name,
        brand: product.brand || null,
        mainCategory: product.mainCategory || null,
        subcategory: product.subcategory || null,
        productType: product.productType || null,
        description: product.description || null,

        productUrl: product.productUrl,
        imageUrl: product.imageUrl,

        relatedProducts: product.relatedProducts,

        sku: product.sku,
        price: product.price,
        quantity: product.quantity,
        source: product.source,
      });

      return {
        success: true,
        name: product.name,
        status: response.status,
        response: response.data,
        attempts: attempt,
      };
    } catch (error) {
      lastError = error;

      const status = error.response?.status;

      const canRetry =
        !status ||
        status === 408 ||
        status === 429 ||
        status >= 500;

      if (!canRetry || attempt > config.retries) {
        break;
      }

      await wait(1500 * attempt);
    }
  }

  return {
    success: false,
    name: product.name,
    status: lastError?.response?.status || null,
    message: lastError?.message || "Unknown error",
    response: lastError?.response?.data || null,
  };
}

function saveReport(report) {
  const reportsFolder = path.resolve("./reports");

  fs.mkdirSync(reportsFolder, {
    recursive: true,
  });

  const date = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");

  const reportPath = path.join(
    reportsFolder,
    `import-report-${date}.json`
  );

  fs.writeFileSync(
    reportPath,
    JSON.stringify(report, null, 2),
    "utf8"
  );

  return reportPath;
}

async function main() {
  if (!config.apiUrl) {
    throw new Error("API_URL is missing in the .env file");
  }

  const startedAt = new Date();
  const products = readProducts();

  console.log("");
  console.log("==============================================");
  console.log(" SMART IT PRODUCTS IMPORT");
  console.log("==============================================");
  console.log(`Excel file : ${config.excelFile}`);
  console.log(`Sheet      : ${config.sheetName}`);
  console.log(`API        : ${config.apiUrl}`);
  console.log(`Products   : ${products.length}`);
  console.log(`Concurrency: ${config.concurrency}`);
  console.log("==============================================");
  console.log("");

  const client = createApiClient();
  const limit = pLimit(config.concurrency);

  let successCount = 0;
  let failedCount = 0;

  const progress = new cliProgress.SingleBar(
    {
      format:
        "Import |{bar}| {percentage}% | {value}/{total} | Success: {success} | Failed: {failed} | {product}",
      hideCursor: true,
      stopOnComplete: true,
    },
    cliProgress.Presets.shades_classic
  );

  progress.start(products.length, 0, {
    success: 0,
    failed: 0,
    product: "Starting...",
  });

  const tasks = products.map((product) =>
    limit(async () => {
      const result = await uploadProduct(client, product);

      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }

      progress.increment({
        success: successCount,
        failed: failedCount,
        product:
          product.name.length > 30
            ? `${product.name.slice(0, 30)}...`
            : product.name,
      });

      return {
        rowNumber: product.rowNumber,
        ...result,
      };
    })
  );

  const results = await Promise.all(tasks);

  progress.stop();

  const finishedAt = new Date();

  const report = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),

    durationSeconds: Number(
      ((finishedAt - startedAt) / 1000).toFixed(2)
    ),

    totals: {
      total: products.length,
      success: successCount,
      failed: failedCount,
    },

    failedProducts: results.filter(
      (result) => !result.success
    ),

    results,
  };

  const reportPath = saveReport(report);

  console.log("");
  console.log("==============================================");
  console.log(" IMPORT FINISHED");
  console.log("==============================================");
  console.log(`Total    : ${products.length}`);
  console.log(`Success  : ${successCount}`);
  console.log(`Failed   : ${failedCount}`);
  console.log(`Duration : ${report.durationSeconds} seconds`);
  console.log(`Report   : ${reportPath}`);
  console.log("==============================================");

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("");
  console.error("IMPORT FAILED");
  console.error(error.response?.data || error.message);
  process.exit(1);
});