import { Canvas, Circle, Path } from '@shopify/react-native-skia';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
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

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { EngineSnapshot } from '@/engine';
import { useTheme } from '@/hooks/use-theme';
import {
  PIN_HIT_RADIUS,
  canvasToStage,
  clampTranslation,
  framePoints,
  hitTestPin,
  makeProjector,
  panBaseline,
  panTo,
  pathForMode,
  pathToSvg,
  pinchAboutFocal,
  pinchBaseline,
  stageToCanvas,
  type MapPathMode,
  type PlacedPin,
} from '@/map/geometry';

const PIN_RADIUS = 6;

type Props = {
  snapshot: EngineSnapshot;
  mode: MapPathMode;
};

export default function FloorMap({ snapshot, mode }: Props) {
  const theme = useTheme();
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const place = useMemo(
    () => makeProjector(framePoints(snapshot), size.width, size.height),
    [size.height, size.width, snapshot],
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

  useLayoutEffect(() => {
    pinsRef.current = placedPins;
  }, [placedPins]);

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
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

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
  const stroke = mode === 'raw' ? theme.textSecondary : theme.text;
  const strokeWidth = mode === 'raw' ? 2 : 3;

  return (
    <View style={styles.fill}>
      <ThemedText
        type="small"
        themeColor={selected ? 'text' : 'textSecondary'}
        testID="map-pin-label"
      >
        {selected ? selected.label : placedPins.length > 0 ? 'tap a pin' : 'no pins'}
      </ThemedText>
      <View
        testID="map-stage"
        style={[styles.stage, { backgroundColor: theme.backgroundElement }]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          widthSv.value = width;
          heightSv.value = height;
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
              {placedPins.map((pin) => (
                <Circle key={pin.id} cx={pin.x} cy={pin.y} r={PIN_RADIUS} color={theme.text} />
              ))}
              {selected ? (
                <Circle
                  cx={selected.x}
                  cy={selected.y}
                  r={PIN_RADIUS + 4}
                  color={theme.text}
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
        <Animated.View
          pointerEvents="none"
          style={[styles.callout, { backgroundColor: theme.background }, calloutStyle]}
        >
          <ThemedText type="small">{selected?.label ?? ''}</ThemedText>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    width: '100%',
    gap: Spacing.two,
  },
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
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
  },
});
