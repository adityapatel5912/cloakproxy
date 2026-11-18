import type { BootResult } from "./bootstrap.js";
import { Workbench } from "./components/Workbench.js";

export default function App({ boot }: { boot: BootResult }) {
  return <Workbench boot={boot} />;
}
