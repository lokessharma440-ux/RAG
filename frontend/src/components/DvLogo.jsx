import React from 'react';
import './DvLogo.css';

export default function DvLogo({ onClick }) {
  return (
    <div
      className="dv-brand-cluster"
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="dv-brand-name">DevMind</span>
    </div>
  );
}
