// secret-scan-audit.js

const XLSX = require("xlsx");
const axios = require("axios");
const fs = require("fs");

const FILE_PATH = "C:\\backend\\FINAL_1468.xlsx";

const BASE_URL =
  "https://acess-backend-production-8856.up.railway.app/devices/scan";

const OUTPUT = "C:\\backend\\secret_scan_result.json";

console.log(`
=====================================================
        SECRET CODE SCAN AUDIT
        FINAL 1468 CHECK
        READ ONLY - NO UPDATE
=====================================================
`);


async function main() {

    if (!fs.existsSync(FILE_PATH)) {
        console.log("❌ FILE NOT FOUND:");
        console.log(FILE_PATH);
        return;
    }


    console.log("📂 Reading Excel...");
    
    const workbook = XLSX.readFile(FILE_PATH);

    const sheetName = workbook.SheetNames[0];

    console.log("Sheet:", sheetName);


    const rows = XLSX.utils.sheet_to_json(
        workbook.Sheets[sheetName],
        {
            defval: ""
        }
    );


    console.log("TOTAL ROWS:", rows.length);


    if(rows.length === 0){
        console.log("❌ No data found");
        return;
    }


    console.log("\nSearching Secret Code column...\n");


    const sample = rows[0];

    console.log("Columns:");
    console.log(Object.keys(sample));


    const secretColumn =
        Object.keys(sample).find(
            x =>
            x.toLowerCase()
            .replace(/\s/g,"")
            .includes("secret")
        );


    if(!secretColumn){

        console.log(`
❌ SECRET CODE COLUMN NOT FOUND

Available columns:
        `);

        console.log(Object.keys(sample));

        return;
    }


    console.log(
        "✅ Secret Column Found:",
        secretColumn
    );


    let result = {

        total: rows.length,

        success: [],

        failed: [],

        emptySecret: []

    };


    let counter = 0;


    for(const row of rows){

        counter++;


        const secret =
            String(row[secretColumn] || "")
            .trim();


        console.log("\n------------------------------------");

        console.log(
            `DEVICE ${counter}/${rows.length}`
        );


        console.log(
            "Secret:",
            secret
        );


        if(!secret){

            console.log(
                "❌ EMPTY SECRET"
            );

            result.emptySecret.push(row);

            continue;
        }


        try{


            const url =
            `${BASE_URL}/${encodeURIComponent(secret)}`;


            const response =
            await axios.get(url);



            console.log("✅ FOUND");

            console.log(
                "Backend ID:",
                response.data.id
            );


            console.log(
                "Device Code:",
                response.data.deviceCode
            );


            console.log(
                "Serial:",
                response.data.serialNumber
            );


            console.log(
                "Name:",
                response.data.deviceName
            );


            console.log(
                "Location:",
                response.data.location
                ?
                response.data.location.excelId
                :
                "NO LOCATION"
            );


            result.success.push({

                secretCode: secret,

                backendId:
                response.data.id,

                deviceCode:
                response.data.deviceCode,

                serial:
                response.data.serialNumber

            });


        }

        catch(error){


            console.log(
                "❌ NOT FOUND"
            );


            console.log(
                "Reason:",
                error.response?.data
                ||
                error.message
            );


            result.failed.push({

                secretCode: secret,

                error:
                error.response?.data
                ||
                error.message

            });

        }


    }


    fs.writeFileSync(
        OUTPUT,
        JSON.stringify(result,null,2),
        "utf8"
    );


    console.log(`

=====================================================
                 FINISHED
=====================================================

TOTAL:
${result.total}

FOUND:
${result.success.length}

FAILED:
${result.failed.length}

EMPTY SECRET:
${result.emptySecret.length}


Report saved:
${OUTPUT}

=====================================================
`);


}


main();