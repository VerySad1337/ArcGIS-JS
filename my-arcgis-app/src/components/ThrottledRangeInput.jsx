import { memo, useState } from "react";
import PropTypes from "prop-types";
import useThrottledCallback from "../hooks/useThrottledCallback";

/**
 * A range input whose thumb tracks the pointer at full frame rate while the
 * value it commits outward is throttled.
 *
 * Both sliders this replaces (a named heatmap layer's intensity, a style
 * group's opacity) hand their value straight to GISMapEngine, where each
 * commit costs a renderer rebuild - and, for a heatmap, a re-render of the
 * whole density surface. Driving that from the raw ~60Hz pointer stream is
 * what made dragging them feel like the UI was fighting back.
 *
 * The displayed position is local state rather than the `value` prop, because
 * a throttled commit means the prop lags a drag in progress by up to one
 * interval; feeding that lagged value back into the input would snap the thumb
 * backwards under the user's finger.
 *
 * `value` is therefore read once, on mount. A caller that needs the slider
 * re-seeded from a value that changed elsewhere (a project load) re-keys it,
 * the same convention LayerControlPanel already uses to re-seed
 * RendererControls' own form state - see its `projectVersion` prop.
 */
function ThrottledRangeInput({ value, min, max, step, ariaLabel, onCommit, className, onDraftChange }) {
  const [draft, setDraft] = useState(value);
  const commit = useThrottledCallback(onCommit);

  const handleChange = (event) => {
    const next = Number(event.target.value);
    setDraft(next);
    onDraftChange?.(next);
    commit(next);
  };

  return (
    <input
      type="range"
      className={className}
      min={min}
      max={max}
      step={step}
      value={draft}
      aria-label={ariaLabel}
      onChange={handleChange}
    />
  );
}

ThrottledRangeInput.propTypes = {
  value: PropTypes.number.isRequired,
  min: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  max: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  step: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  ariaLabel: PropTypes.string,
  onCommit: PropTypes.func.isRequired,
  className: PropTypes.string,
  // Fires synchronously on every pointer event, unlike onCommit. For a caller
  // that renders the live value as text next to the slider and would otherwise
  // show the throttled (lagging) one.
  onDraftChange: PropTypes.func
};

export default memo(ThrottledRangeInput);
