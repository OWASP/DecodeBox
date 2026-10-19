import type { OperationArg } from '../../engine';

interface Props {
  stepUid: string;
  arg: OperationArg;
  onChange: (patch: Partial<OperationArg>) => void;
}

const fieldClass =
  'w-full rounded-control border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-micro ' +
  'text-text outline-hidden transition-colors duration-150 ease-smooth focus:border-accent-line';

export function ArgControl({ stepUid, arg, onChange }: Props) {
  const id = `${stepUid}-${arg.name.replace(/\W+/g, '-')}`;

  if (arg.type === 'boolean') {
    return (
      <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-micro text-muted">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(arg.value)}
          onChange={(e) => onChange({ value: e.target.checked })}
          className="h-3.5 w-3.5 accent-(--accent)"
        />
        {arg.name}
      </label>
    );
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-micro text-faint">
        {arg.name}
      </label>

      {arg.type === 'option' && (
        <select
          id={id}
          value={String(arg.value)}
          onChange={(e) => onChange({ value: e.target.value })}
          className={fieldClass}
        >
          {(arg.options ?? []).map((option) => {
            const label = arg.optionLabels?.[option];
            return (
              <option key={option} value={option}>
                {label ? `${label}: ${option}` : option}
              </option>
            );
          })}
        </select>
      )}

      {arg.type === 'number' && (
        <input
          id={id}
          type="number"
          value={Number(arg.value)}
          min={arg.min}
          max={arg.max}
          onChange={(e) => onChange({ value: Number(e.target.value) })}
          className={fieldClass}
        />
      )}

      {arg.type === 'string' && (
        <input
          id={id}
          type="text"
          value={String(arg.value)}
          placeholder={arg.hint}
          onChange={(e) => onChange({ value: e.target.value })}
          className={fieldClass}
        />
      )}

      {arg.type === 'textarea' && (
        <textarea
          id={id}
          value={String(arg.value)}
          onChange={(e) => onChange({ value: e.target.value })}
          rows={3}
          className={`${fieldClass} resize-y`}
        />
      )}

      {arg.type === 'toggleString' && (
        <div className="flex">
          <select
            aria-label={`${arg.name} format`}
            value={arg.toggleValue ?? arg.toggleValues?.[0] ?? ''}
            onChange={(e) => onChange({ toggleValue: e.target.value })}
            className="rounded-s-control border border-e-0 border-line bg-surface-3 px-2 py-1.5 font-mono text-micro text-muted outline-hidden"
          >
            {(arg.toggleValues ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <input
            id={id}
            type="text"
            value={String(arg.value)}
            placeholder={arg.hint}
            onChange={(e) => onChange({ value: e.target.value })}
            className={`${fieldClass} rounded-s-none`}
          />
        </div>
      )}
    </div>
  );
}
