import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import 'antd/dist/reset.css'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: [theme.darkAlgorithm, theme.compactAlgorithm],
        token: {
          colorPrimary: '#ff6573',
          colorInfo: '#78a7d3',
          colorSuccess: '#65c48b',
          colorWarning: '#d9aa5b',
          colorError: '#e2717f',
          colorText: '#f0f1f3',
          colorTextSecondary: '#9aa0a8',
          colorTextPlaceholder: '#747b84',
          colorBgBase: '#141619',
          colorBgLayout: '#0c0d0f',
          colorBgContainer: '#141619',
          colorBgElevated: '#1b1e22',
          colorFill: 'rgba(240,241,243,0.12)',
          colorFillSecondary: 'rgba(240,241,243,0.08)',
          colorFillTertiary: 'rgba(240,241,243,0.05)',
          colorFillQuaternary: 'rgba(240,241,243,0.03)',
          colorFillAlter: '#1b1e22',
          colorBorder: '#2d3238',
          colorBorderSecondary: '#252a30',
          borderRadius: 4,
          borderRadiusLG: 4,
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
          fontSize: 13,
          controlHeight: 34,
          wireframe: false,
        },
        components: {
          Button: { fontWeight: 600 },
          Card: { bodyPadding: 0, headerHeight: 48, headerFontSize: 14 },
          Input: { activeShadow: '0 0 0 2px rgba(255,101,115,0.18)' },
          Select: { activeOutlineColor: 'rgba(255,101,115,0.18)' },
          Table: {
            headerBg: '#1b1e22',
            headerColor: '#9aa0a8',
            headerSplitColor: 'transparent',
            borderColor: '#2d3238',
            rowHoverBg: '#1c2024',
            bodySortBg: '#181b1f',
            cellPaddingBlockSM: 11,
            cellPaddingInlineSM: 12,
          },
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
