import { ChevronDown, RotateCcw, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Category, SearchMode, SortOrder } from '../../types';
import { label, percent } from '../../lib/format';

export interface SearchPanelProps {
  categories: Category[];
  selected: string[];
  onSelected: (value: string[]) => void;
  advanced: boolean;
  onAdvanced: (value: boolean) => void;
  mode: SearchMode;
  onMode: (value: SearchMode) => void;
  confidence: number;
  minConfidence: number;
  onConfidence: (value: number) => void;
  sort: SortOrder;
  onSort: (value: SortOrder) => void;
  onSearch: () => void;
  onReset: () => void;
  loading: boolean;
  searching: boolean;
}

export function SortSelect({
  value,
  onChange,
}: {
  value: SortOrder;
  onChange: (value: SortOrder) => void;
}) {
  return (
    <div className="select-wrapper">
      <select
        id="sort-results"
        aria-label="Sort Results"
        value={value}
        onChange={(event) => onChange(event.target.value as SortOrder)}
      >
        <option value="confidence_desc">Highest Confidence</option>
        <option value="confidence_asc">Lowest Confidence</option>
        <option value="filename">Filename</option>
        <option value="newest">Newest First</option>
        <option value="oldest">Oldest First</option>
      </select>
      <ChevronDown size={15} />
    </div>
  );
}

export function SearchPanel(props: SearchPanelProps) {
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function outside(event: MouseEvent) {
      if (!popup.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  function toggleCategory(name: string) {
    props.onSelected(
      props.selected.includes(name)
        ? props.selected.filter((item) => item !== name)
        : [...props.selected, name],
    );
  }
  return (
    <section className="search-panel panel" aria-label="Search filters">
      <div className="panel-heading">
        <div className="heading-icon">
          <SlidersHorizontal size={18} />
        </div>
        <h2>Find the objects. Find the image.</h2>
        <label className="switch-label">
          <input
            type="checkbox"
            checked={props.advanced}
            onChange={(event) => {
              props.onAdvanced(event.target.checked);
              if (!event.target.checked) props.onSelected(props.selected.slice(0, 1));
            }}
          />
          <span className="switch-track" />
          Advanced Search
        </label>
      </div>
      <div className="search-controls">
        <div className="object-field field">
          <label htmlFor={props.advanced ? undefined : 'object-select'}>
            {props.advanced ? 'Select Objects' : 'Select an Object'}
          </label>
          {props.advanced ? (
            <div className="multi-select" ref={popup}>
              <button
                className="multi-select-trigger"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-controls="object-options"
                disabled={props.loading || !props.categories.length}
              >
                <Search size={16} />
                <span>
                  {props.selected.length
                    ? `${props.selected.length} object categories selected`
                    : props.loading
                      ? 'Loading categories…'
                      : 'Choose object categories'}
                </span>
                <ChevronDown size={16} />
              </button>
              {open && (
                <div
                  className="multi-select-options"
                  id="object-options"
                  role="group"
                  aria-label="Object categories"
                >
                  {props.categories.map((category) => (
                    <label key={category.class_name}>
                      <input
                        type="checkbox"
                        checked={props.selected.includes(category.class_name)}
                        onChange={() => toggleCategory(category.class_name)}
                      />
                      <span>{label(category.class_name)}</span>
                      <small>{category.image_count} images</small>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="select-wrapper object-select">
              <Search size={16} />
              <select
                id="object-select"
                value={props.selected[0] ?? ''}
                disabled={props.loading || !props.categories.length}
                onChange={(event) =>
                  props.onSelected(event.target.value ? [event.target.value] : [])
                }
              >
                <option value="">
                  {props.loading
                    ? 'Loading categories…'
                    : props.categories.length
                      ? 'Choose an object to search'
                      : 'No objects detected yet'}
                </option>
                {props.categories.map((category) => (
                  <option key={category.class_name} value={category.class_name}>
                    {label(category.class_name)} ({category.image_count} images)
                  </option>
                ))}
              </select>
              <ChevronDown size={16} />
            </div>
          )}
        </div>
        <div className="confidence-field field">
          <label htmlFor="confidence-threshold">
            Minimum Confidence <span>{percent(props.confidence)}</span>
          </label>
          <input
            id="confidence-threshold"
            type="range"
            min={props.minConfidence}
            max="1"
            step="0.01"
            value={props.confidence}
            onChange={(event) => props.onConfidence(Number(event.target.value))}
            style={
              {
                '--range-progress': `${props.minConfidence === 1 ? 100 : ((props.confidence - props.minConfidence) / (1 - props.minConfidence)) * 100}%`,
              } as React.CSSProperties
            }
          />
          <div className="range-labels">
            <span>{percent(props.minConfidence)}</span>
            <span>100%</span>
          </div>
        </div>
        <div className="sort-field field">
          <label htmlFor="sort-results">Sort Results</label>
          <SortSelect value={props.sort} onChange={props.onSort} />
        </div>
        <button
          className="button button-primary search-button"
          onClick={props.onSearch}
          disabled={!props.selected.length || props.loading || props.searching}
        >
          <Search size={17} />
          {props.searching ? 'Searching…' : 'Search Images'}
        </button>
      </div>
      <div className="search-panel-footer">
        <div className="search-context">
          {props.advanced && (
            <div className="segmented mode-toggle" aria-label="Search logic">
              <button
                className={props.mode === 'and' ? 'active' : ''}
                aria-pressed={props.mode === 'and'}
                onClick={() => props.onMode('and')}
              >
                Match all (AND)
              </button>
              <button
                className={props.mode === 'or' ? 'active' : ''}
                aria-pressed={props.mode === 'or'}
                onClick={() => props.onMode('or')}
              >
                Match any (OR)
              </button>
            </div>
          )}
          {props.selected.length ? (
            <div className="selected-chips">
              {props.selected.map((name) => (
                <span className="category-chip" key={name}>
                  {label(name)}
                  <button aria-label={`Remove ${name} filter`} onClick={() => toggleCategory(name)}>
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <span className="filter-hint">
              Search the objects already indexed in your collection.
            </span>
          )}
        </div>
        <button className="text-button reset-filters" onClick={props.onReset}>
          <RotateCcw size={14} />
          Reset Filters
        </button>
      </div>
    </section>
  );
}
