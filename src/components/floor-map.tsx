import { Canvas, Circle, Group, Path } from '@shopify/react-native-skia';
import {
  type ComponentRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, View } from 'react-native';
import {
  GestureDetector,
  useExclusiveGestures,
  usePanGesture,
  usePinchGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';

import { IconButton } from '@/components/button';
import { Glass } from '@/components/glass';
import { PathMarkers } from '@/components/path-markers';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { EngineSnapshot } from '@/engine';
import { useTheme } from '@/hooks/use-theme';
import {
  PIN_HIT_RADIUS,
  boundsEqual,
  boundsOf,
  canvasToStage,
  clampTranslation,
  fitBoundsFor,
  framePoints,
  hitTestPin,
  keptFitBounds,
  makeProjectorFromBounds,
  panBaseline,
  panTo,
  pathForMode,
  pathToSvg,
  pinchAboutFocal,
  pinchBaseline,
  stageToCanvas,
  wheelZoomFactor,
  zoomAt,
  zoomFocal,
  type Bounds,
  type MapPathMode,
  type PlacedPin,
  type XY,
} from '@/map/geometry';

const PIN_RADIUS = 6;
/** Room for the heading cone around the path ends. */
const MARKER_PAD = 40;
/** The zoom column covers the right edge, so the fitted path stays left of it. */
const ZOOM_GUTTER = 56;

type Props = {
  snapshot: EngineSnapshot;
  mode: MapPathMode;
  /** Shown in the glass strip at the bottom until a pin is tapped. */
  summary?: string;
  /** Shown above the map, such as the Raw/Corrected switch. */
  toolbar?: ReactNode;
};

/** Each tap on + or − zooms by this much about the middle of the map. */
const ZOOM_STEP = 1.5;

export default function FloorMap({ snapshot, mode, summary, toolbar }: Props) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fitted, setFitted] = useState<Bounds | null>(null);
  const adjusted = useRef(false);
  const contentRef = useRef<{ bounds: Bounds; points: XY[] } | null>(null);
  const stageRef = useRef<ComponentRef<typeof View>>(null);
  const wheelCleanup = useRef<(() => void) | null>(null);

  const worldBounds = fitBoundsFor(framePoints(snapshot));
  const place = useMemo(
    () =>
      fitted
        ? makeProjectorFromBounds(fitted, size.width - ZOOM_GUTTER, size.height, MARKER_PAD)
        : null,
    [fitted, size.height, size.width],
  );
  const placedPath = useMemo(() => {
    if (!place) return [];
    return pathForMode(snapshot, mode)
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map(place);
  }, [mode, place, snapshot]);
  const placedPins = useMemo(() => {
    if (!place) return [];
    return snapshot.pins
      .filter((pin) => Number.isFinite(pin.x) && Number.isFinite(pin.y))
      .map((pin): PlacedPin => ({ id: pin.id, label: pin.label, ...place(pin) }));
  }, [place, snapshot.pins]);
  const pinsRef = useRef(placedPins);
  const selected = placedPins.find((pin) => pin.id === selectedId) ?? null;
  const selectedX = selected?.x ?? 0;
  const selectedY = selected?.y ?? 0;

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const widthSv = useSharedValue(0);
  const heightSv = useSharedValue(0);
  const pinchStart = useSharedValue({
    scale: 1,
    translateX: 0,
    translateY: 0,
    focalX: 0,
    focalY: 0,
  });
  const pinchArmed = useSharedValue(0);
  const panStart = useSharedValue({ x: 0, y: 0 });
  const panArmed = useSharedValue(0);
  const labelX = useSharedValue(0);
  const labelY = useSharedValue(0);
  const labelOn = useSharedValue(0);

  const markAdjusted = useCallback(() => {
    adjusted.current = true;
  }, []);

  useLayoutEffect(() => {
    pinsRef.current = placedPins;
  }, [placedPins]);

  useLayoutEffect(() => {
    const next = keptFitBounds(adjusted.current, fitted, worldBounds);
    if (fitted && boundsEqual(fitted, next)) return;
    setFitted(next);
  }, [fitted, worldBounds]);

  const fitToContent = () => {
    adjusted.current = false;
    setFitted(worldBounds);
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
  };

  const zoomBy = (factor: number) => {
    adjusted.current = true;
    const current = {
      scale: scale.value,
      translateX: translateX.value,
      translateY: translateY.value,
    };
    const next = zoomAt(current, { x: widthSv.value / 2, y: heightSv.value / 2 }, factor);
    const clamped = clampTranslation(
      { x: next.translateX, y: next.translateY },
      next.scale,
      widthSv.value,
      heightSv.value,
      48,
    );
    scale.value = next.scale;
    translateX.value = clamped.x;
    translateY.value = clamped.y;
  };

  useLayoutEffect(() => {
    if (!place) return;
    const points = framePoints(snapshot)
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .map(place);
    const bounds = boundsOf(points);
    if (!bounds) return;
    contentRef.current = { bounds, points };
  }, [place, snapshot]);

  useLayoutEffect(() => {
    labelX.value = selectedX;
    labelY.value = selectedY;
    labelOn.value = selected ? 1 : 0;
  }, [labelOn, labelX, labelY, selected, selectedX, selectedY]);

  const handleTap = useCallback(
    (x: number, y: number, nextScale: number, tx: number, ty: number) => {
      const local = stageToCanvas({ x, y }, nextScale, tx, ty);
      const hit = hitTestPin(pinsRef.current, local, PIN_HIT_RADIUS / Math.max(nextScale, 1e-6));
      setSelectedId(hit ? hit.id : null);
    },
    [],
  );

  const pinch = usePinchGesture({
    onBegin: () => {
      pinchArmed.value = 0;
      runOnJS(markAdjusted)();
    },
    onUpdate: (event) => {
      if (pinchArmed.value === 0) {
        pinchStart.value = pinchBaseline(
          { scale: scale.value, translateX: translateX.value, translateY: translateY.value },
          { x: event.focalX, y: event.focalY },
          event.scale,
        );
        pinchArmed.value = 1;
      }
      const next = pinchAboutFocal(
        pinchStart.value,
        { x: event.focalX, y: event.focalY },
        event.scale,
      );
      scale.value = next.scale;
      translateX.value = next.translateX;
      translateY.value = next.translateY;
    },
    onFinalize: () => {
      pinchArmed.value = 0;
      const next = clampTranslation(
        { x: translateX.value, y: translateY.value },
        scale.value,
        widthSv.value,
        heightSv.value,
        48,
      );
      translateX.value = next.x;
      translateY.value = next.y;
    },
  });

  const pan = usePanGesture({
    maxPointers: 1,
    minDistance: 10,
    onBegin: () => {
      panArmed.value = 0;
    },
    onUpdate: (event) => {
      if (panArmed.value === 0) {
        panStart.value = panBaseline(
          { x: translateX.value, y: translateY.value },
          { x: event.translationX, y: event.translationY },
        );
        panArmed.value = 1;
        runOnJS(markAdjusted)();
      }
      const next = panTo(panStart.value, { x: event.translationX, y: event.translationY });
      translateX.value = next.x;
      translateY.value = next.y;
    },
    onFinalize: () => {
      panArmed.value = 0;
      const next = clampTranslation(
        { x: translateX.value, y: translateY.value },
        scale.value,
        widthSv.value,
        heightSv.value,
        48,
      );
      translateX.value = next.x;
      translateY.value = next.y;
    },
  });

  const tap = useTapGesture({
    maxDistance: PIN_HIT_RADIUS,
    onActivate: (event) => {
      runOnJS(handleTap)(event.x, event.y, scale.value, translateX.value, translateY.value);
    },
  });

  const dragOrTap = useExclusiveGestures(pan, tap);
  const gesture = useSimultaneousGestures(pinch, dragOrTap);

  const mapStyle = useAnimatedStyle(() => ({
    transformOrigin: 'left top',
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const attachWheel = () => {
    if (wheelCleanup.current) return;
    type WheelLike = {
      deltaY: number;
      deltaMode: number;
      clientX: number;
      clientY: number;
      preventDefault(): void;
    };
    const node = stageRef.current as unknown as {
      addEventListener?: (
        type: string,
        listener: (event: WheelLike) => void,
        options?: { passive?: boolean; capture?: boolean },
      ) => void;
      removeEventListener?: (
        type: string,
        listener: (event: WheelLike) => void,
        options?: { capture?: boolean },
      ) => void;
      getBoundingClientRect?: () => { left: number; top: number };
    } | null;
    if (!node?.addEventListener || !node.removeEventListener || !node.getBoundingClientRect) return;
    const bounds = node.getBoundingClientRect.bind(node);

    const onWheel = (event: WheelLike) => {
      event.preventDefault();
      const rect = bounds();
      adjusted.current = true;
      const fitted = contentRef.current;
      const current = {
        scale: scale.value,
        translateX: translateX.value,
        translateY: translateY.value,
      };
      const focal = zoomFocal(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        current,
        fitted?.points,
      );
      const next = zoomAt(current, focal, wheelZoomFactor(event.deltaY, event.deltaMode));
      const clamped = clampTranslation(
        { x: next.translateX, y: next.translateY },
        next.scale,
        widthSv.value,
        heightSv.value,
        48,
      );
      scale.value = next.scale;
      translateX.value = clamped.x;
      translateY.value = clamped.y;
    };

    node.addEventListener('wheel', onWheel, { passive: false, capture: true });
    wheelCleanup.current = () => node.removeEventListener?.('wheel', onWheel, { capture: true });
  };

  useEffect(() => {
    return () => wheelCleanup.current?.();
  }, []);

  const calloutStyle = useAnimatedStyle(() => {
    const point = canvasToStage(
      { x: labelX.value, y: labelY.value },
      scale.value,
      translateX.value,
      translateY.value,
    );
    const maxX = Math.max(Spacing.two, widthSv.value - 96);
    const maxY = Math.max(Spacing.two, heightSv.value - 36);
    return {
      opacity: labelOn.value,
      transform: [
        { translateX: Math.min(maxX, Math.max(Spacing.two, point.x + 12)) },
        { translateY: Math.min(maxY, Math.max(Spacing.two, point.y - 28)) },
      ],
    };
  });

  const line = pathToSvg(placedPath);
  const stroke = mode === 'raw' ? theme.pathRaw : theme.pathCorrected;
  const strokeWidth = mode === 'raw' ? 2 : 4;
  const start = placedPath[0] ?? null;
  const end = placedPath[placedPath.length - 1] ?? null;

  return (
    <View style={styles.fill}>
      {toolbar}
      <View
        ref={stageRef}
        testID="map-stage"
        style={styles.stage}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          widthSv.set(width);
          heightSv.set(height);
          attachWheel();
          setSize((current) =>
            current.width === width && current.height === height ? current : { width, height },
          );
        }}
      >
        {size.width > 0 && size.height > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, styles.origin, mapStyle]}
          >
            <Canvas style={StyleSheet.absoluteFill}>
              {line ? (
                <Path
                  path={line}
                  color={stroke}
                  style="stroke"
                  strokeWidth={strokeWidth}
                  strokeCap="round"
                  strokeJoin="round"
                />
              ) : null}
              <PathMarkers start={start} end={end} heading={snapshot.heading} />
              {placedPins.map((pin) => (
                <Group key={pin.id}>
                  <Circle cx={pin.x} cy={pin.y} r={PIN_RADIUS + 2.5} color="#ffffff" />
                  <Circle cx={pin.x} cy={pin.y} r={PIN_RADIUS} color={theme.accent} />
                </Group>
              ))}
              {selected ? (
                <Circle
                  cx={selected.x}
                  cy={selected.y}
                  r={PIN_RADIUS + 6}
                  color={theme.accent}
                  style="stroke"
                  strokeWidth={2}
                />
              ) : null}
            </Canvas>
          </Animated.View>
        ) : null}
        <GestureDetector gesture={gesture} touchAction="none">
          <View style={StyleSheet.absoluteFill} collapsable={false} />
        </GestureDetector>
        <Glass style={styles.zoom}>
          <IconButton
            icon="plus"
            label="Zoom in"
            variant="plain"
            onPress={() => zoomBy(ZOOM_STEP)}
          />
          <IconButton
            icon="minus"
            label="Zoom out"
            variant="plain"
            onPress={() => zoomBy(1 / ZOOM_STEP)}
          />
          <IconButton
            icon="fit"
            label="Fit path"
            variant="plain"
            testID="map-fit"
            onPress={fitToContent}
          />
        </Glass>
        <Animated.View pointerEvents="none" style={[styles.callout, calloutStyle]}>
          <Glass style={styles.calloutGlass}>
            <ThemedText type="smallBold">{selected?.label ?? ''}</ThemedText>
          </Glass>
        </Animated.View>
        <View pointerEvents="none" style={styles.footer}>
          <Glass style={styles.footerGlass}>
            <ThemedText
              type="smallBold"
              testID="map-pin-label"
              accessibilityLiveRegion="polite"
              themeColor={selected ? 'text' : 'textSecondary'}
            >
              {selected
                ? selected.label
                : (summary ??
                  (placedPins.length > 0 ? 'Tap a pin to see its name' : 'Pinch to zoom'))}
            </ThemedText>
          </Glass>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    width: '100%',
    overflow: 'hidden',
  },
  origin: {
    transformOrigin: 'left top',
  },
  callout: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  calloutGlass: {
    paddingVertical: Spacing.one + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.medium,
  },
  fill: {
    flex: 1,
    width: '100%',
    gap: Spacing.two,
  },
  zoom: {
    position: 'absolute',
    top: Spacing.two,
    right: 0,
    paddingVertical: Spacing.one,
    borderRadius: 24,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: Spacing.two,
    alignItems: 'center',
  },
  footerGlass: {
    paddingVertical: Spacing.two + Spacing.half,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.large,
  },
});
