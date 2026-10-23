[CmdletBinding()]
param(
  [ValidateSet('Debug','Release')][string]$Variant = 'Release',
  [string]$ServerUrl = 'https://comic.fenda.cc',
  [string]$JavaDirectory = 'D:\tools\android-studio\jbr',
  [string]$SdkDirectory = "$env:LOCALAPPDATA\Android\Sdk"
)
$ErrorActionPreference='Stop'
$taskRoot=[System.IO.Path]::GetFullPath($PSScriptRoot)
$previous=@{}
foreach($name in @('JAVA_HOME','JAVA_OPTS','TEMP','TMP','LIBRETV_TV_KEYSTORE','LIBRETV_TV_KEY_PASSWORD')) { $previous[$name]=[Environment]::GetEnvironmentVariable($name,'Process') }
try {
  $serverUri=[Uri]$ServerUrl
  if(!$serverUri.IsAbsoluteUri -or $serverUri.UserInfo -or $serverUri.Query -or $serverUri.Fragment) { throw 'ServerUrl must be an absolute URL without credentials, query or fragment.' }
  if($Variant -eq 'Release' -and $serverUri.Scheme -ne 'https') { throw 'Release requires an HTTPS server.' }
  $env:JAVA_HOME=$JavaDirectory
  $taskTemp=Join-Path $taskRoot '.gradle\java-tmp'
  [System.IO.Directory]::CreateDirectory($taskTemp) | Out-Null
  $env:TEMP=$taskTemp; $env:TMP=$taskTemp
  $taskSockets=$taskTemp.Replace('\','/')
  $env:JAVA_OPTS="-Djdk.net.unixdomain.tmpdir=$taskSockets"
  [System.IO.File]::WriteAllText((Join-Path $taskRoot 'local.properties'),'sdk.dir='+$SdkDirectory.Replace('\','/'))
  if($Variant -eq 'Release') {
    $signingDirectory=Join-Path $env:LOCALAPPDATA 'LibreTV\signing'
    [System.IO.Directory]::CreateDirectory($signingDirectory) | Out-Null
    $env:LIBRETV_TV_KEYSTORE=Join-Path $signingDirectory 'libretv-tv-release.p12'
    $protectedPassword=Join-Path $signingDirectory 'password.dpapi'
    if(!(Test-Path -LiteralPath $protectedPassword)) {
      $bytes=New-Object byte[] 32
      [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
      $secret=[Convert]::ToBase64String($bytes)
      ConvertTo-SecureString -AsPlainText -Force $secret | ConvertFrom-SecureString | Set-Content -LiteralPath $protectedPassword
    }
    $secure=Get-Content -LiteralPath $protectedPassword | ConvertTo-SecureString
    $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $env:LIBRETV_TV_KEY_PASSWORD=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    if(!(Test-Path -LiteralPath $env:LIBRETV_TV_KEYSTORE)) {
      & (Join-Path $JavaDirectory 'bin\keytool.exe') -genkeypair -keystore $env:LIBRETV_TV_KEYSTORE -storetype PKCS12 -alias libretv -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=LibreTV TV, OU=Personal, O=LibreTV' -storepass:env LIBRETV_TV_KEY_PASSWORD -keypass:env LIBRETV_TV_KEY_PASSWORD
      if($LASTEXITCODE -ne 0) { throw 'Release key generation failed.' }
    }
  }
  & (Join-Path $taskRoot 'gradlew.bat') -p $taskRoot ":app:assemble$Variant" ':app:testDebugUnitTest' --no-daemon --console=plain "-PserverUrl=$($ServerUrl.TrimEnd('/'))" "-Dorg.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8 -Djdk.net.unixdomain.tmpdir=$taskSockets"
  if($LASTEXITCODE -ne 0) { throw 'Android build failed.' }
  $lower=$Variant.ToLowerInvariant()
  $out=Join-Path $taskRoot 'output'
  [System.IO.Directory]::CreateDirectory($out) | Out-Null
  $apk=Join-Path $out "libretv-tv-$lower.apk"
  Copy-Item -LiteralPath (Join-Path $taskRoot "app\build\outputs\apk\$lower\app-$lower.apk") -Destination $apk -Force
  $tools=Get-ChildItem -LiteralPath (Join-Path $SdkDirectory 'build-tools') -Directory | Sort-Object Name -Descending | Select-Object -First 1
  & (Join-Path $tools.FullName 'apksigner.bat') verify --verbose $apk
  if($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
  Get-FileHash -LiteralPath $apk -Algorithm SHA256
  Write-Output "APK: $apk"
}
finally { foreach($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name,$previous[$name],'Process') } }
