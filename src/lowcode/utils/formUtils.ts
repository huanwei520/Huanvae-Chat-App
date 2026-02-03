/**
 * 表单工具函数
 *
 * 提供表单输入处理的通用函数，包括默认值获取、值解析、格式化等
 *
 * @module lowcode/utils/formUtils
 */

import type { DataType } from '../types/lowcode';

// ============================================================================
// 类型定义
// ============================================================================

/** 输入定义（通用） */
export interface InputDefinition {
  /** 输入参数名称 */
  name: string;
  /** 用户友好的显示名称 */
  displayName?: string;
  /** 数据类型 */
  data_type?: DataType | string;
  /** 参数描述 */
  description?: string;
  /** 是否必填 */
  required?: boolean;
  /** 默认值 */
  default_value?: unknown;
  /** LaTeX 格式的参数名 */
  latex_name?: string;
  /** 论文引用说明 */
  paper_ref?: string;
}

// ============================================================================
// 默认值处理
// ============================================================================

/**
 * 获取输入类型的默认值
 *
 * @param dataType - 数据类型
 * @returns 对应类型的默认值
 */
export function getDefaultValue(dataType?: DataType | string): unknown {
  const typeLower = (dataType || 'string').toLowerCase();

  if (typeLower === 'number') return 0;
  if (typeLower === 'boolean') return false;
  if (typeLower === 'array' || typeLower.startsWith('array<')) return [];
  if (typeLower === 'object') return {};
  return '';
}

// ============================================================================
// 值解析
// ============================================================================

/**
 * 解析输入值
 *
 * 支持类型：number, boolean, array, Array<Number>, object, string
 *
 * @param value - 字符串形式的输入值
 * @param dataType - 目标数据类型
 * @returns 解析后的值
 */
export function parseValue(value: string, dataType?: DataType | string): unknown {
  if (!value.trim()) {
    return getDefaultValue(dataType);
  }

  const typeLower = (dataType || 'string').toLowerCase();

  // 数字类型
  if (typeLower === 'number') {
    const num = Number(value);
    return Number.isNaN(num) ? 0 : num;
  }

  // 布尔类型
  if (typeLower === 'boolean') {
    return value.toLowerCase() === 'true';
  }

  // 数组类型（包括 Array<Number> 等泛型）
  if (typeLower === 'array' || typeLower.startsWith('array<')) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return [];

      // 如果是 Array<Number>，确保所有元素都是数字
      if (typeLower.includes('number')) {
        return parsed.map((item) => {
          const num = Number(item);
          return Number.isNaN(num) ? 0 : num;
        });
      }
      return parsed;
    } catch {
      return [];
    }
  }

  // 对象类型
  if (typeLower === 'object') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  // 字符串类型（默认）
  return value;
}

// ============================================================================
// 值格式化
// ============================================================================

/**
 * 将值格式化为字符串（用于表单显示）
 *
 * @param value - 任意类型的值
 * @param dataType - 数据类型
 * @returns 格式化后的字符串
 */
export function formatValue(value: unknown, dataType?: DataType | string): string {
  if (value === undefined || value === null) {
    return '';
  }

  const typeLower = (dataType || 'string').toLowerCase();

  // 数组或对象类型，使用 JSON 格式化
  if (
    typeLower === 'array' ||
    typeLower.startsWith('array<') ||
    typeLower === 'object'
  ) {
    if (typeof value === 'string') {
      return value;
    }
    return JSON.stringify(value, null, 2);
  }

  // 其他类型直接转字符串
  return String(value);
}

// ============================================================================
// 类型判断
// ============================================================================

/**
 * 判断是否为数字类型
 */
export function isNumberType(dataType?: DataType | string): boolean {
  return (dataType || '').toLowerCase() === 'number';
}

/**
 * 判断是否为布尔类型
 */
export function isBooleanType(dataType?: DataType | string): boolean {
  return (dataType || '').toLowerCase() === 'boolean';
}

/**
 * 判断是否为数组类型
 */
export function isArrayType(dataType?: DataType | string): boolean {
  const typeLower = (dataType || '').toLowerCase();
  return typeLower === 'array' || typeLower.startsWith('array<');
}

/**
 * 判断是否为对象类型
 */
export function isObjectType(dataType?: DataType | string): boolean {
  return (dataType || '').toLowerCase() === 'object';
}

/**
 * 判断是否为 JSON 类型（数组或对象）
 */
export function isJsonType(dataType?: DataType | string): boolean {
  return isArrayType(dataType) || isObjectType(dataType);
}
