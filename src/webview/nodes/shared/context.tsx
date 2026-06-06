import React from 'react';

export const InteractionContext = React.createContext<{
  hoveredNetKey?: string;
  setHovered: (netKey?: string, immediate?: boolean) => void;
}>({ setHovered: () => {} });
