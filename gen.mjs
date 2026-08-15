/**
 * Generate Typert artifacts for the dsh-mcp-mgr host package.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { WorkspaceTypertGenerator } from '/Users/fuchee/Documents/Program/PlayGround/deepseek-harness/packages/typert/generator/lib/types/workspace.js'

const root = dirname(fileURLToPath(import.meta.url))
const generator = new WorkspaceTypertGenerator(root)
const artifacts = generator.generate(['dsh-mcp-mgr'], ['host'])
for (const artifact of artifacts) {
  const output = join(root, artifact.packageRoot, 'lib')
  mkdirSync(output, { recursive: true })
  writeFileSync(join(output, `typert.${artifact.face}.js`), artifact.js)
  writeFileSync(join(output, `typert.${artifact.face}.d.ts`), artifact.dts)
  if (artifact.remote !== undefined) {
    writeFileSync(join(output, 'typert.remote-client.js'), artifact.remote.js)
    writeFileSync(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
    writeFileSync(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
  }
  console.log(`emitted ${artifact.package} (face ${artifact.face}) ->`, output)
  console.log(`  remote-client: ${artifact.remote !== undefined}`)
}
