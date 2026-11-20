/** Compare the reviewed upstream tags with the executables installed for this Explorer release. */
export function verifyReviewedBackends(reviewed, projectVersion, analyzerVersion) {
  const changes = [];
  for (const [repository, version] of [["odineska/eska", projectVersion], ["itrous/bsl-analyzer", analyzerVersion]]) {
    const previous = reviewed?.[repository];
    if (typeof previous !== "string" || !/^v\d+\.\d+\.\d+$/.test(previous)) {
      throw new Error(`В docs/reviewed-backends.json требуется проверенный тег ${repository}.`);
    }
    const current = `v${version}`;
    if (current !== previous) changes.push(`https://github.com/${repository}/compare/${previous}...${current}`);
  }
  if (changes.length) {
    throw new Error(`Перед выпуском Explorer разберите изменения и проверьте адаптацию. См. docs/releases.md.\n${changes.join("\n")}`);
  }
}
