function wrap(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function unwrap(arr) {
  return arr.length <= 1 ? arr[0] : arr;
}

class Element {
  constructor(tag, props) {
    this.tag = tag;
    this.props = props;

    this._node = undefined;
    this._children = undefined;

    // flags
    this._isMounted = false;
  }
}

export const Portal = Symbol.for("crank.Portal");

export function createElement(tag, props, ...children) {
  props = Object.assign({}, props);
  if (children.length === 1) {
    props.children = children[0];
  } else if (children.length > 1) {
    props.children = children;
  }

  return new Element(tag, props);
}

function narrow(value) {
  if (typeof value === "boolean" || value == null) {
    return undefined;
  } else if (typeof value === "string" || value instanceof Element) {
    return value;
  }

  return value.toString();
}

export class Renderer {
  constructor() {
    this._cache = new WeakMap();
  }

  render(children, root) {
    let portal = this._cache.get(root);
    if (portal) {
      portal.props = {root, children};
    } else {
      portal = createElement(Portal, {root, children});
      this._cache.set(root, portal);
    }

    return update(this, portal);
  }

  create(el) {
    return document.createElement(el.tag);
  }

  patch(el, node) {
    for (let [name, value] of Object.entries(el.props)) {
      if (name === "children") {
        continue;
      } else if (name === "class") {
        name = "className";
      }

      if (name in node) {
        node[name] = value;
      } else {
        node.setAttribute(name, value);
      }
    }
  }

  arrange(el, node, children) {
    let child = node.firstChild;
    for (const newChild of children) {
      if (child === newChild) {
        child = child.nextSibling;
      } else if (typeof newChild === "string") {
        if (child !== null && child.nodeType === Node.TEXT_NODE) {
          child.nodeValue = newChild;
          child = child.nextSibling;
        } else {
          node.insertBefore(document.createTextNode(newChild), child);
        }
      } else {
        node.insertBefore(newChild, child);
      }
    }

    while (child !== null) {
      const nextSibling = child.nextSibling;
      node.removeChild(child);
      child = child.nextSibling;
    }
  }
}

function diff(renderer, oldChild, newChild) {
  if (
    oldChild instanceof Element &&
    newChild instanceof Element &&
    oldChild.tag === newChild.tag
  ) {
    if (oldChild !== newChild) {
      oldChild.props = newChild.props;
      newChild = oldChild;
    }
  }

  let value;
  if (newChild instanceof Element) {
    value = update(renderer, newChild);
  } else {
    value = newChild;
  }

  return [newChild, value];
}

function update(renderer, el) {
  if (el._isMounted) {
    el = createElement(el, {...el.props});
  }

  const oldChildren = wrap(el._children);
  const newChildren = wrap(el.props.children);
  const children = [];
  const values = [];
  const length = Math.max(oldChildren.length, newChildren.length);
  for (let i = 0; i < length; i++) {
    const oldChild = oldChildren[i];
    const newChild = narrow(newChildren[i]);
    const [child, value] = diff(renderer, oldChild, newChild);
    children.push(child);
    if (value) {
      values.push(value);
    }
  }

  el._children = unwrap(children);
  return commit(renderer, el, values);
}

function commit(renderer, el, values) {
  if (el.tag === Portal) {
    renderer.arrange(el, el.props.root, values);
    return undefined;
  } else if (!el._node) {
    el._node = renderer.create(el);
  }

  renderer.patch(el, el._node);
  renderer.arrange(el, el._node, values);
  return el._node;
}
