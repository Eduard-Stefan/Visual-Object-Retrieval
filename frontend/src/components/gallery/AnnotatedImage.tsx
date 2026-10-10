import type { IndexedImage } from '../../types';
import { categoryColor, label, percent } from '../../lib/format';

export function AnnotatedImage({
  image,
  confidence,
  annotated,
  selected = [],
  showOthers = true,
  original = false,
}: {
  image: IndexedImage;
  confidence: number;
  annotated: boolean;
  selected?: string[];
  showOthers?: boolean;
  original?: boolean;
}) {
  const detections = image.detections.filter(
    (detection) =>
      detection.confidence >= confidence &&
      (showOthers || !selected.length || selected.includes(detection.class_name)),
  );
  const fontSize = Math.max(10, image.width / 42);
  return (
    <div className="annotated-image" style={{ aspectRatio: `${image.width} / ${image.height}` }}>
      <img
        src={original ? image.file_url : image.thumbnail_url}
        alt={image.filename}
        loading={original ? 'eager' : 'lazy'}
      />
      {annotated && (
        <svg
          viewBox={`0 0 ${image.width} ${image.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label={`${detections.length} detected objects`}
          role="img"
        >
          {detections.map((detection) => {
            const color = categoryColor(detection.class_name);
            const text = `${label(detection.class_name)} ${percent(detection.confidence)}`;
            const textWidth = Math.min(
              image.width,
              text.length * fontSize * 0.58 + fontSize * 0.75,
            );
            const x = Math.min(detection.x1, image.width - textWidth);
            const y = Math.max(0, detection.y1 - fontSize * 1.5);
            const matched = !selected.length || selected.includes(detection.class_name);
            return (
              <g key={detection.id} opacity={matched ? 1 : 0.35}>
                <rect
                  x={detection.x1}
                  y={detection.y1}
                  width={detection.x2 - detection.x1}
                  height={detection.y2 - detection.y1}
                  fill="none"
                  stroke={color}
                  strokeWidth={matched ? 2.2 : 1.2}
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={x}
                  y={y}
                  width={textWidth}
                  height={fontSize * 1.5}
                  rx={fontSize * 0.15}
                  fill={color}
                />
                <text
                  x={x + fontSize * 0.35}
                  y={y + fontSize * 1.08}
                  fill="white"
                  fontSize={fontSize}
                  fontWeight="600"
                >
                  {text}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
