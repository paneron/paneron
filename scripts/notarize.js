const { spawn } = require("child_process");
const { chdir } = require("process");

const exec = async function exec(cmd, args = []) {
  const child = spawn(cmd, args, { shell: true });
  redirectOutputFor(child);
  await waitFor(child);
};

const redirectOutputFor = child => {
  const printStdout = data => {
    process.stdout.write(data.toString());
  };
  const printStderr = data => {
    process.stderr.write(data.toString());
  };
  child.stdout.on("data", printStdout);
  child.stderr.on("data", printStderr);

  child.once("close", () => {
    child.stdout.off("data", printStdout);
    child.stderr.off("data", printStderr);
  });
};

const waitFor = async function(child) {
  return new Promise(resolve => {
    child.once("close", () => resolve());
  });
};

exports.default = async function notarizing(context) {

  const { notarize } = await import('@electron/notarize');

  const isMac = context.targets.find(
    target => target.name === "mac" || target.name === "dmg",
  );
  const targetNames = context.targets.map(t => t.name).join(', ');
  if (!isMac) {
    console.warn("after sign; will not notarize for target", targetNames);
    return;
  }

  console.warn("after sign; notarize for target", targetNames);

  await exec("security find-identity -p codesigning -v");

  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: "org.paneron.desktop",
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_ID_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID,
  });
};
