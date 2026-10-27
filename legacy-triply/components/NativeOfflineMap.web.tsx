import type { MapSnapshot } from '@/types/travel';

interface NativeOfflineMapProps {
  snapshot: MapSnapshot;
  displaySnapshot: MapSnapshot;
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
  onSelectSegment?: (segmentId: string) => void;
  onSnapshotChange: (snapshot: MapSnapshot) => void;
}

export const nativeOfflineMapAvailable = false;

export function NativeOfflineMap(_props: NativeOfflineMapProps) {
  return null;
}