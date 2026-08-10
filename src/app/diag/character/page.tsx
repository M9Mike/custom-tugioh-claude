import CharacterLab from './CharacterLab';

/**
 * A workbench for the duelist model. Not linked from anywhere — you come here
 * on purpose, the same way you do to `/diag`.
 *
 * Imported directly rather than through `next/dynamic`: this is a Server
 * Component, which may not ask for `ssr: false`, and it does not need to. The
 * lab is a client component whose three.js work all happens inside an effect,
 * so there is nothing for the server to trip over.
 */
export default function Page() {
  return <CharacterLab />;
}
