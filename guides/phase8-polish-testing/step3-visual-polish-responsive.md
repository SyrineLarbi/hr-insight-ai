# Phase 8 - Step 3: Visual Polish + Responsive Design

## Why Are We Doing This?

The app is functional but needs the finishing touches that make it feel professional:

1. **Color-coded risk throughout** — every risk-related element uses the green/amber/red system consistently
2. **Responsive layout** — sidebar collapses, tables scroll horizontally, forms stack vertically on mobile
3. **Consistent spacing** — unified padding, margins, card borders
4. **Micro-interactions** — hover effects, transitions, focus states

---

## What We're Doing

This step is modifications to existing files — no new files. Key improvements:

### A: Global theme customization

Update the ConfigProvider theme in `(dashboard)/layout.tsx`:

```typescript
<ConfigProvider
  theme={{
    token: {
      colorPrimary: '#1677ff',
      borderRadius: 8,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    components: {
      Layout: {
        siderBg: '#fff',
        headerBg: '#fff',
      },
      Table: {
        headerBg: '#fafafa',
      },
      Card: {
        paddingLG: 20,
      },
    },
    algorithm: theme.defaultAlgorithm,
  }}
>
```

### B: Risk color consistency

Create a helper component that's used everywhere risk is displayed:

```typescript
// frontend/src/components/common/risk-tag.tsx
'use client';

import { Tag } from 'antd';
import { getRiskLevel, RISK_COLORS, RISK_LABELS } from '@/lib/constants';

interface RiskTagProps {
  score: number; // 0-1
}

export default function RiskTag({ score }: RiskTagProps) {
  const level = getRiskLevel(score);
  return (
    <Tag color={RISK_COLORS[level]}>
      {RISK_LABELS[level]} ({Math.round(score * 100)}%)
    </Tag>
  );
}
```

Use this in: Reports table, Employee detail, Dashboard risk display.

### C: Responsive table handling

For tables with many columns (employees), add horizontal scroll:

```typescript
<Table
  columns={columns}
  dataSource={data}
  scroll={{ x: 900 }}  // enables horizontal scroll on small screens
  pagination={{ pageSize: 15, responsive: true }}
/>
```

### D: Responsive form layout

For employee add/edit modals with many fields:

```typescript
<Form form={form} layout="vertical">
  <Row gutter={16}>
    <Col xs={24} sm={12}>
      <Form.Item name="name" label="Name" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
    </Col>
    <Col xs={24} sm={12}>
      <Form.Item name="salary" label="Salary" rules={[{ required: true }]}>
        <InputNumber min={1} style={{ width: '100%' }} />
      </Form.Item>
    </Col>
    {/* ... more fields in 2-column grid that stacks on mobile */}
  </Row>
</Form>
```

### E: Sidebar collapse behavior

The sidebar already has `breakpoint="lg"` which auto-collapses. Add a manual toggle:

```typescript
const [collapsed, setCollapsed] = useState(false);

<Sider
  width={220}
  collapsible
  collapsed={collapsed}
  onCollapse={setCollapsed}
  breakpoint="lg"
  collapsedWidth={80}
  style={{ background: '#fff', borderRight: '1px solid #f0f0f0' }}
>
```

### F: Empty state improvements

For pages with no data, use meaningful messages:

```typescript
<Empty
  image={Empty.PRESENTED_IMAGE_SIMPLE}
  description={
    <span>
      No reports generated yet.{' '}
      <RoleGate allowed={['ADMIN', 'HR_MANAGER', 'TEAM_MANAGER']}>
        Go to the <a href="/dashboard">Dashboard</a> to generate your first insight report.
      </RoleGate>
    </span>
  }
/>
```

---

## How to Verify It Worked

1. **Mobile view**: Open DevTools → toggle device toolbar → iPhone 14 viewport
   - Sidebar auto-collapsed to icon-only mode
   - Tables scroll horizontally (no overflow)
   - Forms stack vertically
   - Cards fill width
2. **Risk colors**: Every risk score in the app uses green/amber/red consistently
3. **Theme**: All antd components use the blue primary color, 8px border radius
4. **Empty states**: Navigate to Reports page (no reports) → meaningful message with link

---

## Checklist

- [ ] ConfigProvider theme applied globally with corporate tokens
- [ ] `risk-tag.tsx` component used consistently across all risk displays
- [ ] Tables have `scroll={{ x: ... }}` for mobile horizontal scroll
- [ ] Employee form fields use `Row`/`Col` grid for responsive layout
- [ ] Sidebar has manual collapse toggle + auto-collapse on mobile
- [ ] Empty states have helpful messages with navigation links
- [ ] All risk-related UI elements use consistent green/amber/red colors
- [ ] No horizontal overflow on any page at 375px width (iPhone SE)

---

Once confirmed, move to **Step 4: End-to-End Smoke Tests** — the final verification.
