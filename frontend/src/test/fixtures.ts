import type { Category, IndexedImage, ProcessingJob } from '../types';

export const categories: Category[] = [
  { class_id: 0, class_name: 'person', image_count: 3, object_count: 5 },
  { class_id: 2, class_name: 'car', image_count: 2, object_count: 4 },
];

export const indexedImage: IndexedImage = {
  id: 'image-one',
  filename: 'street.png',
  width: 800,
  height: 600,
  uploaded_at: '2026-10-10T10:00:00Z',
  status: 'completed',
  model: 'yolo11m.pt',
  file_url: '/api/images/image-one/file',
  thumbnail_url: '/api/images/image-one/thumbnail',
  object_count: 3,
  matching_count: 1,
  score: 0.8,
  detections: [
    { id: 1, class_id: 0, class_name: 'person', confidence: 0.9, x1: 10, y1: 20, x2: 200, y2: 400 },
    { id: 2, class_id: 2, class_name: 'car', confidence: 0.8, x1: 100, y1: 200, x2: 700, y2: 550 },
    { id: 3, class_id: 16, class_name: 'dog', confidence: 0.3, x1: 20, y1: 50, x2: 300, y2: 500 },
  ],
};

export const processingJob: ProcessingJob = {
  id: 'job-one',
  status: 'processing',
  total: 4,
  processed: 1,
  uploaded: 1,
  duplicates: 0,
  failed: 0,
  errors: [],
};
