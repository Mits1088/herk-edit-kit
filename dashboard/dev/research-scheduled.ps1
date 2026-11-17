# Unattended research run: Claude Code runs the research-signals skill for one topic and imports the batch.
# Research and import only. Made for Windows Task Scheduler ("Run only when user is logged on").
#   powershell -NoProfile -File dashboard\dev\research-scheduled.ps1 -Topic n8n
# One run at a time (a lock file); every run writes reels-data\research\logs\<stamp>-<topic>.log and adds one line
# to reels-data\research\logs\runs.jsonl. Exit codes: 0 imported, 2 another run is active, 3 Claude failed or
# timed out, 4 Claude finished but no batch was imported, 5 imported but at least one lane failed.
param([Parameter(Mandatory = $true)][string]$Topic, [int]$TimeoutMinutes = 25)
$ErrorActionPreference = 'Stop'
if ($Topic -notmatch '^[A-Za-z0-9][A-Za-z0-9 _-]{0,40}$') { Write-Error 'Topic: letters, digits, spaces, - and _ only'; exit 1 }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$logs = Join-Path $root 'reels-data\research\logs'; New-Item -ItemType Directory -Force $logs | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHHmmssZ'); $slug = ($Topic.ToLower() -replace '[^a-z0-9]+', '-')
$log = Join-Path $logs "$stamp-$slug.log"; $runs = Join-Path $logs 'runs.jsonl'; $searches = Join-Path $root 'reels-data\research\searches.jsonl'
function Note($t) { Add-Content -Path $log -Value ("[{0}] {1}" -f (Get-Date).ToUniversalTime().ToString('HH:mm:ssZ'), $t) -Encoding utf8 }
function Finish($code, $outcome, $extra) {
  $rec = [ordered]@{ at = $stamp; topic = $Topic; exit = $code; outcome = $outcome; log = "reels-data/research/logs/$stamp-$slug.log" }
  if ($extra) { foreach ($k in $extra.Keys) { $rec[$k] = $extra[$k] } }
  Add-Content -Path $runs -Value ($rec | ConvertTo-Json -Compress -Depth 5) -Encoding utf8
  Note "exit $code : $outcome"; exit $code
}

# One run at a time: the lock is held open for the life of this process, so a crash releases it.
try { $lock = [IO.File]::Open((Join-Path $logs 'run.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
catch { Note 'Another research run holds the lock. Nothing was started.'; Finish 2 'skipped: another run is active' $null }

$before = if (Test-Path $searches) { @(Get-Content $searches).Count } else { 0 }
$work = Join-Path $root "tmp\research-run\$stamp-$slug"; New-Item -ItemType Directory -Force $work | Out-Null
$prompt = @"
Run the research-signals skill for the topic: $Topic
This is an unattended scheduled run. Ask no questions and wait for no one.
Use this folder as the working folder for the draft and the last30free output files: $work
Bounds: Signal Room limit 5; detail for at most 3 Instagram results and 2 YouTube results per lane; last30free with --quick --days 30; at most 3 subtitle fetches. One retry at most for any failed call.
If the Signal Room tools are missing or refuse, do not stop: record the exact error text for each Signal Room lane in the draft's signalRoom.errors and continue with last30free.
Build the batch, run the importer dry run, then import. If a batch id for today and this topic exists, add a suffix.
Do research and import only. Do not save ideas, export, rewrite, approve or publish anything, and do not edit any file outside that working folder and what the skill's own commands write.
End with the skill's report: per lane the post count, transcripts, dated measurements, and every failure with its exact error.
"@
$allowed = 'Skill,Read,Write,Edit,Glob,Grep,Bash,mcp__signal-room'
$claude = (Get-Command claude -ErrorAction Stop).Source
Note "topic '$Topic' | claude $(& $claude --version) | user $env:USERNAME | session $((Get-Process -Id $PID).SessionId) | work $work"

$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = $claude; $psi.WorkingDirectory = $root; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
$psi.Arguments = "-p --output-format json --max-turns 80 --no-session-persistence --allowedTools $allowed"
$psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
$psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
$p = [Diagnostics.Process]::Start($psi)
$bytes = [Text.Encoding]::UTF8.GetBytes($prompt); $p.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length); $p.StandardInput.Close() # the prompt goes in on stdin; nothing else can be typed
$outT = $p.StandardOutput.ReadToEndAsync(); $errT = $p.StandardError.ReadToEndAsync()
if (-not $p.WaitForExit($TimeoutMinutes * 60000)) { try { & taskkill /PID $p.Id /T /F | Out-Null } catch {}; Note "Timed out after $TimeoutMinutes minutes; the process tree was stopped."; Finish 3 'failed: timed out' $null }
$out = $outT.Result; $err = $errT.Result
if ($err.Trim()) { Note "stderr: $($err.Trim())" }
$j = $null; try { $j = $out | ConvertFrom-Json } catch { Note "Output was not JSON: $($out.Substring(0, [Math]::Min(2000, $out.Length)))" }
if ($j) { Note "claude: is_error=$($j.is_error) turns=$($j.num_turns) cost_usd=$($j.total_cost_usd) denials=$(@($j.permission_denials).Count)"; foreach ($d in @($j.permission_denials)) { Note "permission denied: $($d.tool_name) $(($d.tool_input | ConvertTo-Json -Compress -Depth 4))" }; Add-Content -Path $log -Value "`n--- report ---`n$($j.result)" -Encoding utf8 }

# What the importer recorded, lane by lane. A failed lane is listed, never hidden.
$after = if (Test-Path $searches) { @(Get-Content $searches) } else { @() }
$lanes = @(); if ($after.Count -gt $before) { $b = $after[-1] | ConvertFrom-Json; $lanes = @($b.runs | ForEach-Object { "$($_.provider)/$($_.lane)=$($_.status)" + $(if ($_.error) { " ($($_.error))" } else { '' }) }); Note "imported $($b.batchId): $($lanes -join '; ')" }
$lock.Close()
if ($p.ExitCode -ne 0 -or -not $j -or $j.is_error) { Finish 3 "failed: claude exit $($p.ExitCode)" @{ lanes = $lanes } }
if ($after.Count -le $before) { Finish 4 'failed: no batch was imported' $null }
if (@($b.runs | Where-Object { $_.status -ne 'ok' }).Count) { Finish 5 'imported, with failed lanes' @{ batch = $b.batchId; lanes = $lanes } }
Finish 0 'imported' @{ batch = $b.batchId; lanes = $lanes }
