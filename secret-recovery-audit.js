const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const readline = require("readline");


const ROOT = "C:\\backend\\";


// الملفات عندك بالاسم الصحيح
const FILE_ALL = path.join(ROOT, "all-devices.xlsx");

const FILE_641 = path.join(ROOT, "CORRECT_REMAINING_641_.xlsx");

const FILE_FINAL = path.join(ROOT, "FINAL_1468.xlsx");


// الناتج
const OUTPUT = path.join(
    ROOT,
    "FINAL_1468_SECRET_FIXED.xlsx"
);

const REPORT = path.join(
    ROOT,
    "SECRET_CODE_AUDIT_REPORT.xlsx"
);

const BACKUP = path.join(
    ROOT,
    "FINAL_BACKUP_BEFORE_FIX.xlsx"
);



function ask(question){

    return new Promise(resolve=>{

        const rl = readline.createInterface({
            input:process.stdin,
            output:process.stdout
        });


        rl.question(question,(answer)=>{

            rl.close();
            resolve(answer);

        });

    });

}




function loadExcel(file){

    console.log("\nREADING:");
    console.log(file);


    const workbook = XLSX.readFile(file);

    console.log(
        "SHEET:",
        workbook.SheetNames[0]
    );


    return XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]],
        {
            defval:""
        }
    );

}




async function main(){


console.clear();


console.log(`
=====================================================
        SECRET CODE RECOVERY TOOL
        641 DEVICES PROTECTION MODE
        FULL AUDIT
=====================================================
`);




console.log("\nCHECKING FILES...\n");



[
FILE_ALL,
FILE_641,
FILE_FINAL

].forEach(file=>{


    if(!fs.existsSync(file)){


        console.log(
            "FILE NOT FOUND:"
        );


        console.log(file);


        process.exit();

    }

});



console.log(
"ALL FILES FOUND OK"
);





const ALL = loadExcel(FILE_ALL);

const LIST641 = loadExcel(FILE_641);

let BACKEND = loadExcel(FILE_FINAL);





console.log(`
=====================================================

ALL DEVICES:
${ALL.length}

641 LIST:
${LIST641.length}

BACKEND:
${BACKEND.length}

=====================================================
`);






console.log(
"\nCREATING BACKUP..."
);


fs.copyFileSync(
    FILE_FINAL,
    BACKUP
);


console.log(
"BACKUP:"
);

console.log(BACKUP);







let allMap = new Map();



ALL.forEach(d=>{


    let serial =
    String(d["Serial Number"]).trim();


    if(serial){

        allMap.set(
            serial,
            d
        );

    }


});





let listMap = new Map();



LIST641.forEach(d=>{


    let serial =
    String(d["Serial Number"]).trim();


    if(serial){

        listMap.set(
            serial,
            d
        );

    }


});






console.log(`
DATABASE READY

OLD SECRET DATABASE:
${allMap.size}

PROTECTED 641:
${listMap.size}

`);





let checked = 0;

let updated = [];

let skipped = [];







console.log(`
=====================================================
START CHECK
=====================================================
`);






BACKEND.forEach(device=>{


    let serial =
    String(device["Serial Number"]).trim();



    if(!listMap.has(serial))
        return;




    checked++;


    let protectedDevice =
    listMap.get(serial);



    let oldDevice =
    allMap.get(serial);





    console.log(`
-----------------------------------------------------
DEVICE ${checked} / ${listMap.size}
SERIAL:
${serial}
`);





    if(!oldDevice){


        console.log(
        "❌ OLD SECRET NOT FOUND"
        );


        skipped.push({

            Serial:serial,

            Reason:"Not found in all-devices"

        });


        return;

    }






    let mismatch=[];




    [
        "Device ID",
        "Cluster",
        "Zone",
        "Direction"
    ]

    .forEach(field=>{


        if(
            String(device[field]).trim()
            !==
            String(protectedDevice[field]).trim()
        ){


            mismatch.push(field);


        }


    });







    if(mismatch.length>0){


        console.log(
        "❌ DATA MISMATCH:"
        );


        console.log(
        mismatch.join(", ")
        );


        skipped.push({

            Serial:serial,

            Reason:mismatch.join(",")

        });


        return;

    }






    console.log(
    "CURRENT SECRET:"
    );


    console.log(
    device["Secret Code"]
    );



    console.log(
    "OLD SECRET:"
    );


    console.log(
    oldDevice["Secret Code"]
    );






    if(
        device["Secret Code"]
        !==
        oldDevice["Secret Code"]
    ){



        console.log(
        "✅ UPDATE SECRET ONLY"
        );



        device["Secret Code"]
        =
        oldDevice["Secret Code"];




        updated.push({

            Serial:serial,

            Secret:
            oldDevice["Secret Code"]

        });



    }

    else{


        console.log(
        "OK - SAME SECRET"
        );


    }



});







console.log(`
=====================================================
RESULT

CHECKED:
${checked}

UPDATED:
${updated.length}

SKIPPED:
${skipped.length}


ONLY COLUMN CHANGED:
Secret Code

=====================================================
`);






let answer =
await ask(
"\nTYPE YES TO SAVE FINAL FILE: "
);





if(answer.trim() !== "YES"){


console.log(
"CANCELLED"
);


process.exit();


}






let wb =
XLSX.utils.book_new();



XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(BACKEND),
    "Import Ready 1468"
);



XLSX.writeFile(
    wb,
    OUTPUT
);





let report =
XLSX.utils.book_new();



XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.json_to_sheet(
        [
            ...updated,
            ...skipped
        ]
    ),
    "AUDIT"
);



XLSX.writeFile(
    report,
    REPORT
);





console.log(`
=====================================================
DONE

FINAL:
${OUTPUT}

REPORT:
${REPORT}

BACKUP:
${BACKUP}

=====================================================
`);




}



main();