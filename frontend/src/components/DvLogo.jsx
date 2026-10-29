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
      <div className="dv-square-badge">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Document outline */}
          <path
            d="M14 2H6C4.89543 2 4 2.89543 4 4V20C4 21.1046 4.89543 22 6 22H18C19.1046 22 20 21.1046 20 20V8L14 2Z"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M14 2V8H20"
            stroke="#ffffff"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Neural Vector Core */}
          <circle cx="11" cy="14" r="2.2" fill="#3b82f6" stroke="#60a5fa" strokeWidth="1.2" />
          <path d="M11 11.8V9.5" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M11 16.2V18.5" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M8.8 14H6.5" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M13.2 14H15.5" stroke="#60a5fa" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </div>
      <div className="dv-brand-text-wrap">
        <span className="dv-brand-name">DevMind</span>
        <span className="dv-brand-tag font-mono">AI</span>
      </div>
    </div>
  );
}
