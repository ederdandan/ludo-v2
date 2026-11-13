# Gera assets/textures/*.ktx2 a partir da madeira CC0 "oak_veneer_01" (Poly Haven).
# Uso: pwsh scripts/encode-textures.ps1 C:\caminho\basisu.exe   (basis_universal 1.16+)
#   albedo -> ETC1S sRGB | rough -> ETC1S linear | normal -> UASTC linear + zstd
param([Parameter(Mandatory)][string]$Basisu)
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot '..\assets\textures'
New-Item -ItemType Directory -Force $out | Out-Null
$out = (Resolve-Path $out).Path
$src = Join-Path ([IO.Path]::GetTempPath()) ("oak-" + [guid]::NewGuid())
New-Item -ItemType Directory $src | Out-Null
$url = 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/oak_veneer_01/oak_veneer_01'
foreach ($m in 'diff', 'nor_gl', 'rough') { Invoke-WebRequest "${url}_${m}_1k.jpg" -OutFile "$src\$m.jpg" }
Push-Location $src
try {
  & $Basisu -ktx2 -mipmap -q 220 -comp_level 2 diff.jpg -output_file "$out\oak_albedo.ktx2"
  if ($LASTEXITCODE) { throw 'falha no albedo' }
  & $Basisu -ktx2 -mipmap -linear -q 160 -comp_level 2 rough.jpg -output_file "$out\oak_rough.ktx2"
  if ($LASTEXITCODE) { throw 'falha no rough' }
  & $Basisu -ktx2 -mipmap -linear -normal_map -uastc -uastc_level 2 -uastc_rdo_l 1.5 nor_gl.jpg -output_file "$out\oak_normal.ktx2"
  if ($LASTEXITCODE) { throw 'falha no normal' }
} finally { Pop-Location; Remove-Item -Recurse -Force $src }
Get-ChildItem $out
