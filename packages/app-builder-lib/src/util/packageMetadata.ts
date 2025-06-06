import { InvalidConfigurationError, isEmptyOrSpaces, log } from "builder-util"
import { Nullish } from "builder-util-runtime"
import { readFile, readJson, readJsonSync } from "fs-extra"
import * as path from "path"
import * as semver from "semver"
import { Metadata } from "../options/metadata"
import { normalizePackageData } from "./normalizePackageData"

/** @internal */
export async function readPackageJson(file: string): Promise<any> {
  const data = await readJson(file)
  await authors(file, data)
  // remove not required fields because can be used for remote build
  delete data.scripts
  delete data.readme
  normalizePackageData(data)
  return data
}

async function authors(file: string, data: any) {
  if (data.contributors != null) {
    return
  }

  let authorData
  try {
    authorData = await readFile(path.resolve(path.dirname(file), "AUTHORS"), "utf8")
  } catch (_ignored) {
    return
  }

  data.contributors = authorData.split(/\r?\n/g).map(it => it.replace(/^\s*#.*$/, "").trim())
}

/** @internal */
export function checkMetadata(metadata: Metadata, devMetadata: any | null, appPackageFile: string, devAppPackageFile: string): void {
  const errors: Array<string> = []
  const reportError = (missedFieldName: string) => {
    errors.push(`Please specify '${missedFieldName}' in the package.json (${appPackageFile})`)
  }

  const checkNotEmpty = (name: string, value: string | Nullish) => {
    if (isEmptyOrSpaces(value)) {
      reportError(name)
    }
  }

  if ((metadata as any).directories != null) {
    errors.push(`"directories" in the root is deprecated, please specify in the "build"`)
  }

  checkNotEmpty("name", metadata.name)

  if (isEmptyOrSpaces(metadata.description)) {
    log.warn({ appPackageFile }, `description is missed in the package.json`)
  }
  if (metadata.author == null) {
    log.warn({ appPackageFile }, `author is missed in the package.json`)
  }
  checkNotEmpty("version", metadata.version)

  checkDependencies(metadata.dependencies, errors)
  if (metadata !== devMetadata) {
    if (metadata.build != null) {
      errors.push(
        `'build' in the application package.json (${appPackageFile}) is not supported since 3.0 anymore. Please move 'build' into the development package.json (${devAppPackageFile})`
      )
    }
  }

  const devDependencies = (metadata as any).devDependencies
  if (devDependencies != null && ("electron-rebuild" in devDependencies || "@electron/rebuild" in devDependencies)) {
    log.info(
      '@electron/rebuild already used by electron-builder, please consider to remove excess dependency from devDependencies\n\nTo ensure your native dependencies are always matched electron version, simply add script `"postinstall": "electron-builder install-app-deps" to your `package.json`'
    )
  }

  if (errors.length > 0) {
    throw new InvalidConfigurationError(errors.join("\n"))
  }
}

function versionSatisfies(version: string | semver.SemVer | null, range: string | semver.Range, loose?: boolean): boolean {
  if (version == null) {
    return false
  }

  const coerced = semver.coerce(version)
  if (coerced == null) {
    return false
  }

  return semver.satisfies(coerced, range, loose)
}

function checkDependencies(dependencies: Record<string, string> | Nullish, errors: Array<string>) {
  if (dependencies == null) {
    return
  }

  let updaterVersion = dependencies["electron-updater"]
  if (updaterVersion != null) {
    // Pick the version out of yarn berry patch syntax
    // "patch:electron-updater@npm%3A6.4.1#~/.yarn/patches/electron-updater-npm-6.4.1-ef33e6cc39.patch"
    if (updaterVersion.startsWith("patch:")) {
      const match = updaterVersion.match(/@npm%3A(.+?)#/)
      if (match) {
        updaterVersion = match[1]
      }
    }

    // for testing auto-update using workspace electron-updater
    if (updaterVersion.startsWith("file:")) {
      const normalized = path.normalize(updaterVersion.substring("file:".length))
      const packageJsonPath = path.isAbsolute(normalized) ? normalized : path.resolve(__dirname, normalized)
      const json = readJsonSync(path.join(packageJsonPath, "package.json"))
      updaterVersion = json.version
    }

    const requiredElectronUpdaterVersion = "4.0.0"
    if (!versionSatisfies(updaterVersion, `>=${requiredElectronUpdaterVersion}`)) {
      errors.push(
        `At least electron-updater ${requiredElectronUpdaterVersion} is recommended by current electron-builder version. Please set electron-updater version to "^${requiredElectronUpdaterVersion}". Received "${updaterVersion}"`
      )
    }
  }

  const swVersion = dependencies["electron-builder-squirrel-windows"]
  if (swVersion != null && !versionSatisfies(swVersion, ">=20.32.0")) {
    errors.push(`At least electron-builder-squirrel-windows 20.32.0 is required by current electron-builder version. Please set electron-builder-squirrel-windows to "^20.32.0"`)
  }

  const deps = ["electron", "electron-prebuilt", "electron-rebuild"]
  if (process.env.ALLOW_ELECTRON_BUILDER_AS_PRODUCTION_DEPENDENCY !== "true") {
    deps.push("electron-builder")
  }
  for (const name of deps) {
    if (name in dependencies) {
      errors.push(`Package "${name}" is only allowed in "devDependencies". ` + `Please remove it from the "dependencies" section in your package.json.`)
    }
  }
}
