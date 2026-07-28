import type { CharacterTrait } from '../engine/types';
import { traitRarityClassName, traitRarityLabel } from './openingCustomOptions';

interface OpeningTraitButtonProps {
  trait: CharacterTrait;
  selected: boolean;
  onToggle: (traitId: string) => void;
}

export function OpeningTraitButton({ trait, selected, onToggle }: OpeningTraitButtonProps) {
  return (
    <button
      type="button"
      className={`trait-chip ${traitRarityClassName(trait)} ${selected ? 'selected' : ''}`}
      title={`${trait.label}：${trait.description}${trait.promptHint ? `\n${trait.promptHint}` : ''}`}
      aria-pressed={selected}
      onClick={() => onToggle(trait.id)}
    >
      <strong>
        <span className="trait-label-text">{trait.label}</span>
        <span className="trait-chip-badges">
          <em className="trait-rarity-tag">{traitRarityLabel(trait)}</em>
          {selected && <em className="trait-selected-mark" aria-hidden="true">已选</em>}
        </span>
      </strong>
      <span className="trait-description">{trait.description}</span>
    </button>
  );
}
