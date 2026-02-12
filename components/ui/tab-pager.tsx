import { forwardRef, useImperativeHandle, useState, Children } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

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
    const [activePage, setActivePage] = useState(initialPage);
    const childArray = Children.toArray(children);

    useImperativeHandle(ref, () => ({
      setPage: (index: number) => {
        setActivePage(index);
        onPageSelected?.(index);
      },
    }));

    return (
      <View style={[{ flex: 1 }, style]}>
        {childArray[activePage]}
      </View>
    );
  }
);
