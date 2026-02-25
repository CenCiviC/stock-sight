import { forwardRef, useImperativeHandle, useRef } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import PagerView from "react-native-pager-view";

export interface TabPagerRef {
  setPage: (index: number) => void;
}

interface TabPagerProps {
  initialPage?: number;
  onPageSelected?: (index: number) => void;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

export const TabPager = forwardRef<TabPagerRef, TabPagerProps>(
  ({ initialPage = 0, onPageSelected, style, children }, ref) => {
    const pagerRef = useRef<PagerView>(null);

    useImperativeHandle(ref, () => ({
      setPage: (index: number) => pagerRef.current?.setPage(index),
    }));

    return (
      <PagerView
        ref={pagerRef}
        style={style}
        initialPage={initialPage}
        onPageSelected={(e) => onPageSelected?.(e.nativeEvent.position)}
      >
        {children}
      </PagerView>
    );
  },
);

TabPager.displayName = "TabPagerNative";
