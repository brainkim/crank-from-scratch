function wrap(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

class Element {
  constructor(tag, props) {
    this.tag = tag;
    this.props = props;
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

export class Renderer {
  render(children, root) {
    const portal = createElement(Portal, {root}, children);
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

function update(renderer, el) {
  const values = [];
  for (const child of wrap(el.props.children)) {
    if (child instanceof Element) {
      values.push(update(renderer, child));
    } else if (child) {
      values.push(child);
    }
  }

  return commit(renderer, el, values);
}

function commit(renderer, el, values) {
  if (el.tag === Portal) {
    renderer.arrange(el, el.props.root, values);
    return undefined;
  }

  const node = renderer.create(el);
  renderer.patch(el, node);
  renderer.arrange(el, node, values);
  return node;
}
