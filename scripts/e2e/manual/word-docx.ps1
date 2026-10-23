# „Pobierz .docx” w prawdziwym Wordzie (COM, tylko do odczytu): czy plik otwiera się bez okna
# naprawy, czy właściwości nie mają autora ani ostatniego edytującego, czy cały tekst ma język
# polski (1045) i czy znaczniki [PESEL] są pogrubione. Z -Zrzuty Word jest widoczny, a skrypt
# zapisuje zrzut okna z otwartym okienkiem „Sprawdź ułatwienia dostępu”.
#
# Pliki pobierz z aplikacji („Pobierz .docx” po ?demo i po wczytaniu fixtures/urzad/decyzja.docx).
#   powershell -ExecutionPolicy Bypass -File scripts/e2e/manual/word-docx.ps1 -Pliki a.docx,b.docx [-Zrzuty katalog]
param(
  [Parameter(Mandatory = $true)][string[]]$Pliki,
  [string]$Zrzuty = ''
)
# powershell -File podaje listę jako jeden napis „a.docx,b.docx”
$Pliki = $Pliki | ForEach-Object { $_ -split ',' } | Where-Object { $_ }
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Okno {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[void][Okno]::SetProcessDPIAware()

function Wlasciwosc($doc, [string]$nazwa) {
  $props = $doc.BuiltInDocumentProperties
  try {
    $p = [System.__ComObject].InvokeMember('Item', 'GetProperty', $null, $props, @($nazwa))
    return [string][System.__ComObject].InvokeMember('Value', 'GetProperty', $null, $p, $null)
  } catch { return '' }
}

function Zrzut($word, [string]$plik) {
  $h = [IntPtr][int64]$word.ActiveWindow.Hwnd
  Start-Sleep -Milliseconds 1500
  $r = New-Object Okno+RECT
  [void][Okno]::GetWindowRect($h, [ref]$r)
  $bmp = New-Object System.Drawing.Bitmap ($r.R - $r.L), ($r.B - $r.T)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  # PrintWindow rysuje samo okno Worda: inne okna, które je przykrywają, nie trafiają do zrzutu.
  $hdc = $g.GetHdc()
  [void][Okno]::PrintWindow($h, $hdc, 2)
  $g.ReleaseHdc($hdc)
  $bmp.Save($plik, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}

$word = New-Object -ComObject Word.Application
$word.Visible = [bool]$Zrzuty
$word.DisplayAlerts = 0
$bledy = 0
try {
  foreach ($f in $Pliki) {
    $sciezka = (Resolve-Path $f).Path
    # ConfirmConversions: nie, ReadOnly: tak, AddToRecentFiles: nie. Uszkodzony plik przy
    # DisplayAlerts = 0 kończy się wyjątkiem zamiast okna naprawy.
    $doc = $word.Documents.Open($sciezka, $false, $true, $false)
    $nazwa = Split-Path $sciezka -Leaf
    $autor = Wlasciwosc $doc 'Author'
    $ostatni = Wlasciwosc $doc 'Last Author'
    $tytul = Wlasciwosc $doc 'Title'
    $jezyk = $doc.Content.LanguageID
    $pesel = $doc.Content
    $pogrubiony = $null
    if ($pesel.Find.Execute('[PESEL]')) { $pogrubiony = $pesel.Font.Bold }
    "$nazwa"
    "  otwarty: tak, akapitów: $($doc.Paragraphs.Count), tylko do odczytu: $($doc.ReadOnly)"
    ('  tytuł: [{0}], autor: [{1}], ostatni zapisujący: [{2}]' -f $tytul, $autor, $ostatni)
    "  język treści: $jezyk (1045 = polski), [PESEL] pogrubiony: $pogrubiony"
    if ($autor -or $ostatni) { "  BŁĄD: autor we właściwościach"; $bledy++ }
    if ($jezyk -ne 1045) { "  BŁĄD: język treści inny niż polski"; $bledy++ }
    # Tryb zgodności (np. 14 albo 11) wyłącza w Wordzie sprawdzanie ułatwień dostępu.
    "  tryb zgodności: $($doc.CompatibilityMode) (15 = bieżący)"
    if ($doc.CompatibilityMode -lt 15) { "  BŁĄD: dokument otwiera się w trybie zgodności"; $bledy++ }
    if ($Zrzuty) {
      New-Item -ItemType Directory -Force $Zrzuty | Out-Null
      $baza = Join-Path $Zrzuty ([System.IO.Path]::GetFileNameWithoutExtension($nazwa))
      $word.ActiveWindow.WindowState = 1 # maksymalizacja
      Zrzut $word "$baza-word.png"
      try {
        $word.CommandBars.ExecuteMso('AccessibilityChecker')
        Start-Sleep -Seconds 3
        Zrzut $word "$baza-dostepnosc.png"
      } catch { "  (okienko ułatwień dostępu nie otworzyło się przez COM: $($_.Exception.Message))" }
    }
    $doc.Close(0)
  }
} catch {
  "BŁĄD: $($_.Exception.Message)"
  $bledy++
} finally {
  $z = 0; $word.Quit([ref]$z)
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
if ($bledy) { exit 1 }
