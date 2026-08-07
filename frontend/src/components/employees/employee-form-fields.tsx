'use client';

import { Form, Input, InputNumber, Row, Col } from 'antd';

interface EmployeeFormFieldsProps {
  /** On edit, PATCH accepts partial bodies so fields are not required. */
  required: boolean;
}

/**
 * The 9 employee metric fields, shared by the team-detail and employees-list
 * edit modals. Bounds mirror CreateEmployeeDto so the client rejects the same
 * values the server would.
 */
export default function EmployeeFormFields({ required }: EmployeeFormFieldsProps) {
  return (
    <>
      <Form.Item
        name="name"
        label="Name"
        rules={[
          { required, message: 'Name is required' },
          { min: 2, max: 100, message: 'Name must be 2-100 characters' },
        ]}
      >
        <Input placeholder="Jane Doe" />
      </Form.Item>

      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item
            name="salary"
            label="Salary ($)"
            rules={[
              { required, message: 'Salary is required' },
              { type: 'number', min: 1, message: 'Salary must be greater than 0' },
            ]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item
            name="tenureMonths"
            label="Tenure (months)"
            rules={[
              { required, message: 'Tenure is required' },
              { type: 'number', min: 0, message: 'Tenure cannot be negative' },
            ]}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item
            name="engagementScore"
            label="Engagement (1-5)"
            rules={[
              { required, message: 'Engagement is required' },
              { type: 'number', min: 1, max: 5, message: 'Must be between 1 and 5' },
            ]}
          >
            <InputNumber min={1} max={5} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item
            name="performanceScore"
            label="Performance (1-5)"
            rules={[
              { required, message: 'Performance is required' },
              { type: 'number', min: 1, max: 5, message: 'Must be between 1 and 5' },
            ]}
          >
            <InputNumber min={1} max={5} step={0.1} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item
            name="absenteeismDays"
            label="Absenteeism (days)"
            rules={[
              { required, message: 'Absenteeism is required' },
              { type: 'number', min: 0, message: 'Cannot be negative' },
            ]}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item
            name="overtimeHours"
            label="Overtime (h/week)"
            rules={[
              { required, message: 'Overtime is required' },
              { type: 'number', min: 0, message: 'Cannot be negative' },
            ]}
          >
            <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} sm={12}>
          <Form.Item
            name="lastPromotionMonths"
            label="Last Promotion (months)"
            rules={[
              { required, message: 'Last promotion is required' },
              { type: 'number', min: 0, message: 'Cannot be negative' },
            ]}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item
            name="trainingHours"
            label="Training (hours)"
            rules={[
              { required, message: 'Training hours is required' },
              { type: 'number', min: 0, message: 'Cannot be negative' },
            ]}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Col>
      </Row>
    </>
  );
}
