import { SAMPLES } from "../../engine/samples.js";

interface Props {
  onSelect: (text: string, label: string) => void;
}

export function SamplesBar({ onSelect }: Props) {
  return (
    <section className="samples" aria-label="Built-in sample payloads">
      <span className="samples-label">1-CLICK SAMPLES</span>
      {SAMPLES.map((sample) => (
        <button
          key={sample.id}
          type="button"
          className="sample-button"
          title={sample.hint}
          onClick={() => onSelect(sample.text, sample.label)}
        >
          {sample.label}
        </button>
      ))}
    </section>
  );
}
