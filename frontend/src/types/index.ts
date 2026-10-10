export type SortOrder = 'confidence_desc' | 'confidence_asc' | 'filename' | 'newest' | 'oldest';
export type SearchMode = 'and' | 'or';
export type View = 'search' | 'collection' | 'statistics';
export interface Detection {
  id: number;
  class_id: number;
  class_name: string;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface IndexedImage {
  id: string;
  filename: string;
  width: number;
  height: number;
  uploaded_at: string;
  status: string;
  model: string | null;
  error?: string | null;
  file_url: string;
  thumbnail_url: string;
  detections: Detection[];
  object_count: number;
  matching_count: number;
  score: number | null;
}
export interface PaginatedImages {
  items: IndexedImage[];
  total: number;
  page: number;
  page_size: number;
}
export interface Category {
  class_id: number;
  class_name: string;
  image_count: number;
  object_count: number;
}
export interface Statistics {
  total_images: number;
  total_objects: number;
  total_categories: number;
  distribution: { class_name: string; count: number }[];
}
export interface SystemInfo {
  model: string;
  device: string;
  half: boolean;
  ready: boolean;
  error: string | null;
  hardware: Record<string, unknown>;
  detection_confidence: number;
  warnings?: string[];
  max_file_mb?: number;
  max_upload_files?: number;
  max_upload_body_mb?: number;
}
export interface ProcessingJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  total: number;
  processed: number;
  uploaded: number;
  duplicates: number;
  failed: number;
  errors: string[];
}
