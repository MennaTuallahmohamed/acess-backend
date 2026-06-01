$ErrorActionPreference = "SilentlyContinue"

$backendPath = "C:\backend"
$missingJson = Join-Path $backendPath "missing-images.json"
$uploadsPath = Join-Path $backendPath "uploads"
$foundReport = Join-Path $backendPath "found-restored-images.csv"

if (!(Test-Path $missingJson)) {
  Write-Host "missing-images.json not found. Run node scripts\check-missing-images.js first." -ForegroundColor Red
  exit
}

if (!(Test-Path $uploadsPath)) {
  New-Item -ItemType Directory -Path $uploadsPath | Out-Null
}

$missing = Get-Content $missingJson -Raw | ConvertFrom-Json

$nameMap = @{}
foreach ($img in $missing) {
  if ($img.filename -and !$nameMap.ContainsKey($img.filename)) {
    $nameMap[$img.filename] = $img
  }
}

Write-Host "Need to find:" $nameMap.Count "files" -ForegroundColor Yellow

$roots = @(
  "C:\Users\IT",
  "C:\backend",
  "D:\",
  "E:\",
  "F:\"
) | Where-Object { Test-Path $_ }

$skipParts = @(
  "\node_modules\",
  "\dist\",
  "\build\",
  "\.git\",
  "\.cache\",
  "\AppData\Local\Temp\"
)

$found = New-Object System.Collections.Generic.List[Object]

foreach ($root in $roots) {
  Write-Host "Searching in $root ..." -ForegroundColor Cyan

  Get-ChildItem -Path $root -Recurse -File -Include *.jpg,*.jpeg,*.png,*.webp | ForEach-Object {
    $full = $_.FullName

    $skip = $false
    foreach ($part in $skipParts) {
      if ($full -like "*$part*") {
        $skip = $true
        break
      }
    }

    if ($skip) {
      return
    }

    if ($nameMap.ContainsKey($_.Name)) {
      $target = Join-Path $uploadsPath $_.Name

      Copy-Item $_.FullName $target -Force

      $row = [PSCustomObject]@{
        FileName = $_.Name
        Source = $_.FullName
        Target = $target
        Size = $_.Length
        LastWriteTime = $_.LastWriteTime
      }

      $found.Add($row) | Out-Null

      Write-Host "FOUND:" $_.Name "=>" $_.FullName -ForegroundColor Green
    }
  }
}

$found | Export-Csv $foundReport -NoTypeInformation -Encoding UTF8

Write-Host "====================================" -ForegroundColor Yellow
Write-Host "Found and restored:" $found.Count -ForegroundColor Green
Write-Host "Copied into:" $uploadsPath
Write-Host "Report:" $foundReport
Write-Host "====================================" -ForegroundColor Yellow