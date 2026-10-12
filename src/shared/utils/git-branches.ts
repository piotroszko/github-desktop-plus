import simpleGit from "simple-git";

/**
 * @description Branch refs of a repository, remote-tracking ones first — what
 * "compare against develop" usually means — then local branches.
 *
 * @param localPath - Absolute path to the repository working directory
 * @returns Distinct-ish refs as git names them (`origin/develop`, `develop`),
 *   `HEAD` entries excluded
 */
export async function listBranchRefs(localPath: string): Promise<string[]> {
  const { all } = await simpleGit(localPath).branch(["-a"]);
  const remote: string[] = [];
  const local: string[] = [];
  for (const ref of all) {
    if (ref === "HEAD") {
      continue;
    }
    if (ref.startsWith("remotes/")) {
      const name = ref.replace(/^remotes\//, "");
      if (!name.endsWith("/HEAD")) {
        remote.push(name);
      }
    } else {
      local.push(ref);
    }
  }
  return [...remote.sort(), ...local.sort()];
}
